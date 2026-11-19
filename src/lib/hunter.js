/**
 * Hunter.io enrichment: website URL -> registrable domain -> Domain Search
 * (+ optional Email Finder for an owner name found on the website).
 *
 * Docs: https://hunter.io/api-documentation/v2
 * Domain Search is rate-limited by Hunter to 15 req/s and 500 req/min, so we
 * stay well under that and back off on 429.
 */
import { getDomain } from 'tldts';

const API = 'https://api.hunter.io/v2';

// Website hosts / link services where a domain search is pointless and burns credits.
const PLATFORM_DOMAINS = new Set([
    'facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'x.com', 'tiktok.com', 'youtube.com',
    'linktr.ee', 'linkin.bio', 'beacons.ai', 'wa.me', 'whatsapp.com', 'google.com', 'goo.gl', 'g.page',
    'business.site', 'sites.google.com', 'blogspot.com', 'wordpress.com', 'wixsite.com', 'wix.com',
    'squarespace.com', 'godaddysites.com', 'weebly.com', 'webflow.io', 'carrd.co', 'yolasite.com',
    'jimdosite.com', 'site123.me', 'mystrikingly.com', 'yelp.com', 'yelp.ca', 'justdial.com',
    'booksy.com', 'vagaro.com', 'fresha.com', 'setmore.com', 'square.site', 'shopify.com', 'myshopify.com',
    'zomato.com', 'swiggy.com', 'practo.com', 'tripadvisor.com', 'opentable.com', 'calendly.com',
    'indiamart.com', 'sulekha.com', 'amazon.com', 'amazon.in', 'etsy.com', 'ubereats.com', 'doordash.com',
]);

// Higher = more likely to be the person who signs off on marketing spend.
const SENIORITY_RANK = { executive: 3, senior: 2, junior: 0 };
const DEPT_RANK = { executive: 2, management: 1.5, marketing: 1, sales: 0.5 };
const OWNER_POSITION_RE = /\b(owner|co-?owner|founder|co-?founder|ceo|chief executive|president|proprietor|managing (director|partner)|principal|partner|director|general manager)\b/i;
const STRICT_OWNER_RE = /\b(owner|co-?owner|founder|co-?founder|ceo|chief executive|president|proprietor|managing (director|partner)|principal (dentist|doctor|physician|broker)|managing partner)\b/i;
const validEmail = (email) => /^[a-z0-9][a-z0-9._%+-]*@(?:[a-z0-9-]+\.)+[a-z]{2,24}$/i.test(email || '');

/** "https://www.shop.brightsmile.co.uk/about" -> "brightsmile.co.uk" (null for platforms / junk). */
export function domainForHunter(url) {
    if (!url) return null;
    const domain = getDomain(String(url).trim(), { allowPrivateDomains: false });
    if (!domain) return null;
    const d = domain.toLowerCase();
    if (PLATFORM_DOMAINS.has(d)) return null;
    // Hosts like "sites.google.com" collapse to google.com above; catch free-mail domains too.
    if (/^(gmail|yahoo|hotmail|outlook|icloud|aol|live|rediffmail)\./.test(d)) return null;
    return d;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class HunterClient {
    /**
     * @param {{ apiKey: string, minIntervalMs?: number, maxRetries?: number, log?: any, fetchImpl?: typeof fetch }} opts
     */
    constructor({ apiKey, minIntervalMs = 150, maxRetries = 3, log = console, fetchImpl = globalThis.fetch }) {
        if (!apiKey) throw new Error('Hunter API key is missing.');
        this.apiKey = apiKey;
        this.minIntervalMs = minIntervalMs;
        this.maxRetries = maxRetries;
        this.log = log;
        this.fetch = fetchImpl;
        this.nextSlot = 0;
        this.disabled = null; // reason string once we must stop (bad key, out of credits)
        this.stats = { domainSearches: 0, emailFinders: 0, errors: 0, rateLimited: 0 };
    }

    // Spaces requests out evenly even when called concurrently.
    async throttle() {
        const now = Date.now();
        const wait = Math.max(0, this.nextSlot - now);
        this.nextSlot = Math.max(now, this.nextSlot) + this.minIntervalMs;
        if (wait) await sleep(wait);
    }

    async request(path, params) {
        if (this.disabled) return null;
        const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== ''));
        const url = `${API}/${path}?${qs}`;
        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            await this.throttle();
            let res;
            try {
                res = await this.fetch(url, { headers: { 'X-API-KEY': this.apiKey, Accept: 'application/json' } });
            } catch (err) {
                this.log.warning?.(`Hunter network error (${path}): ${err.message}`);
                await sleep(1000 * (attempt + 1));
                continue;
            }
            const body = await res.json().catch(() => ({}));
            if (res.ok) return body;

            const details = (body?.errors || []).map((e) => e.details || e.id).join('; ') || res.statusText;
            if (res.status === 429 && !/usage|credit|plan|limit reached|quota/i.test(details)) {
                this.stats.rateLimited += 1;
                await sleep(2000 * (attempt + 1));
                continue;
            }
            if (res.status === 401 || res.status === 402 || res.status === 403 || res.status === 429) {
                // Invalid key, or account out of searches/credits: stop calling for the rest of the run.
                this.disabled = `Hunter ${res.status}: ${details}`;
                this.log.error?.(`${this.disabled} — Hunter enrichment disabled for the rest of this run.`);
                return null;
            }
            if (res.status >= 500) { await sleep(1500 * (attempt + 1)); continue; }
            // 400 / 451 etc. are specific to this query (e.g. invalid domain, person opted out).
            this.stats.errors += 1;
            this.log.debug?.(`Hunter ${res.status} for ${url.replace(/api_key=[^&]+/, '')}: ${details}`);
            return null;
        }
        this.stats.errors += 1;
        return null;
    }

    /** Fetch all pages, up to a configured cap; Hunter returns at most 100 emails per request. */
    async domainSearch(domain, { limit = 100, maxEmails = limit, type = null, seniority = null, department = null } = {}) {
        const cap = Math.min(1000, Math.max(1, Number(maxEmails) || 100));
        const pageSize = Math.min(100, Math.max(1, Number(limit) || 100));
        const found = new Map();
        let offset = 0;
        let totalResults = null;
        let organization = null, pattern = null, acceptAll = null;
        while (offset < cap && !this.disabled) {
            const count = Math.min(pageSize, cap - offset);
            const body = await this.request('domain-search', { domain, limit: count, offset, type, seniority, department });
            if (!body) break;
            this.stats.domainSearches += 1;
            const data = body.data || {};
            organization ??= data.organization || null;
            pattern ??= data.pattern || null;
            acceptAll ??= data.accept_all ?? null;
            totalResults = body.meta?.results ?? totalResults;
            const batch = data.emails || [];
            for (const raw of batch) {
                const email = normaliseHunterEmail(raw);
                if (email && email.verification !== 'invalid') {
                    found.set(email.email, { ...(found.get(email.email) || {}), ...email });
                }
            }
            offset += batch.length;
            if (batch.length < count || (totalResults != null && offset >= totalResults)) break;
        }
        if (!this.stats.domainSearches) return null;
        return {
            domain, organization, pattern, acceptAll, totalResults,
            fetchedResults: found.size,
            truncated: totalResults != null ? totalResults > offset : offset >= cap,
            emails: [...found.values()],
        };
    }

    /** Email Finder: most likely email for a known person at a domain. */
    async emailFinder(domain, fullName) {
        const clean = String(fullName || '').replace(/^(Dr|Mr|Mrs|Ms)\.?\s+/i, '').trim();
        const parts = clean.split(/\s+/);
        if (parts.length < 2) return null;
        const body = await this.request('email-finder', {
            domain, first_name: parts[0], last_name: parts[parts.length - 1],
        });
        if (!body?.data?.email) return null;
        this.stats.emailFinders += 1;
        return normaliseHunterEmail({ ...body.data, value: body.data.email, type: 'personal', confidence: body.data.score });
    }
}

function normaliseHunterEmail(e) {
    if (!e?.value || !validEmail(String(e.value).trim())) return null;
    const name = [e.first_name, e.last_name].filter(Boolean).join(' ').trim() || null;
    return {
        email: String(e.value).toLowerCase(),
        type: e.type || null, // "personal" | "generic"
        confidence: e.confidence ?? null, // 0-100
        name,
        position: e.position || null,
        seniority: e.seniority || null,
        department: e.department || null,
        linkedin: e.linkedin || null,
        phone: e.phone_number || null,
        verification: e.verification?.status || null,
        provenance: e.provenance || null,
        decisionMaker: e.decision_maker === true, // "valid" | "accept_all" | "unknown" | ...
    };
}

/** Score a Hunter person as a likely owner / decision-maker. */
export function decisionMakerScore(p) {
    if (!p.name) return -1;
    let s = (SENIORITY_RANK[p.seniority] ?? 1) + (DEPT_RANK[p.department] ?? 0);
    if (p.position && OWNER_POSITION_RE.test(p.position)) s += 3;
    if (p.decisionMaker) s += 1;
    if (p.verification === 'valid') s += 0.5;
    s += (p.confidence ?? 50) / 100;
    return s;
}

/**
 * Merge Hunter results into the merged website data (from mergeSiteResults).
 * Website-found owner wins when it has high confidence; Hunter fills the gaps.
 */
export function applyHunter(site, hunter, finderResult = null) {
    const out = site ? { ...site } : { emails: [], phones: [], socials: {}, owner: null, ownerCandidates: [], audit: null };
    if (!hunter && !finderResult) return out;

    const people = [...(hunter?.emails || [])];
    if (finderResult && !people.some((p) => p.email === finderResult.email)) people.unshift(finderResult);
    const named = people.filter((p) => p.name).sort((a, b) => decisionMakerScore(b) - decisionMakerScore(a));

    // Add Hunter emails behind the website's own emails, personal first.
    const hunterEmails = people
        .filter((p) => p.verification !== 'invalid')
        .sort((a, b) => (b.type === 'personal') - (a.type === 'personal') || decisionMakerScore(b) - decisionMakerScore(a))
        .map((p) => p.email);
    out.emails = [...new Set([...(out.emails || []), ...hunterEmails])];
    out.emailSources = Object.fromEntries([
        ...hunterEmails.map((e) => [e, 'hunter']),
        ...(site?.emails || []).map((e) => [e, 'website']),
    ]);

    let owner = out.owner ? { ...out.owner } : null;
    if (owner) {
        // Website gave us a name: pull that person's email/LinkedIn from Hunter if we have it.
        const first = owner.name.replace(/^(Dr|Mr|Mrs|Ms)\.?\s+/i, '').split(' ')[0].toLowerCase();
        const last = owner.name.split(' ').pop().toLowerCase();
        const match = people.find((p) => p.name && p.name.toLowerCase().includes(first) && p.name.toLowerCase().includes(last));
        if (match) {
            owner.email ||= match.email;
            owner.linkedin ??= match.linkedin;
            owner.emailStatus = match.verification;
            owner.title ??= match.position;
        }
    }
    // A person is not automatically the owner just because they are senior or the only named contact.
    const likelyOwners = named.filter((p) => p.position && STRICT_OWNER_RE.test(p.position));
    const bestHunter = likelyOwners[0];
    const websiteOwnerWeak = !owner || (owner.confidence ?? 0) < 0.6 || !owner.title;
    if (bestHunter && websiteOwnerWeak && decisionMakerScore(bestHunter) >= 2) {
        if (owner) out.ownerCandidates = [...(out.ownerCandidates || []), owner];
        owner = {
            name: bestHunter.name,
            title: bestHunter.position || null,
            email: bestHunter.email,
            linkedin: bestHunter.linkedin,
            emailStatus: bestHunter.verification,
            source: 'hunter',
            confidence: Math.min(0.95, Number(((bestHunter.confidence ?? 50) / 100).toFixed(2))),
        };
    }
    out.owner = owner;
    out.hunterContacts = people.map((p) => ({ ...p, source: 'hunter' }));
    out.ownerCandidates = [
        ...(out.ownerCandidates || []),
        ...named.filter((p) => p.name !== owner?.name).map((p) => ({
            name: p.name, title: p.position, email: p.email, source: 'hunter', confidence: (p.confidence ?? 50) / 100,
        })),
    ];
    out.hunter = {
        domain: hunter?.domain || null,
        organization: hunter?.organization || null,
        pattern: hunter?.pattern || null,
        acceptAll: hunter?.acceptAll ?? null,
        resultsCount: people.length,
        availableResults: hunter?.totalResults ?? null,
        truncated: hunter?.truncated ?? false,
    };
    return out;
}

/** Should we spend Hunter credits on this site? */
export function needsHunter(site, mode) {
    if (mode === 'always') return true;
    if (mode !== 'fallback') return false;
    const hasPersonal = (site?.emails || []).some((e) => !/^(info|contact|hello|hi|admin|office|support|sales|enquir|inquir|mail|team|booking|reception|service|help)/i.test(e));
    return !(site?.owner?.name && site?.owner?.email && hasPersonal);
}

/**
 * Run Hunter over all places. `cache` is a persisted object (domain -> result)
 * so migrations / re-runs never pay twice for the same domain.
 *
 * @returns {Promise<{ sites: Record<string, object>, stats: object }>} placeKey -> updated site data
 */
export async function enrichWithHunter(places, sites, {
    apiKey, mode = 'always', findOwnerEmail = true, limit = 100, maxEmails = 100, concurrency = 4, cache = {}, log = console,
    onProgress = null, fetchImpl,
}) {
    const client = new HunterClient({ apiKey, log, fetchImpl });
    const out = { ...sites };
    // Cache the full response by domain and query settings, not just the domain.
    // Otherwise a previous 10-email lookup could mask a later 100-email lookup.
    const jobs = [];
    let skipped = 0;
    for (const p of places) {
        const site = sites[p.placeKey] || null;
        if (!needsHunter(site, mode)) { skipped += 1; continue; }
        // Prefer the URL the site actually redirected to (old domains often forward to new ones).
        const domain = domainForHunter(site?.audit?.finalUrl) || domainForHunter(p.website);
        if (!domain) { skipped += 1; continue; }
        jobs.push({ place: p, site, domain });
    }

    // Persisted cache holds results; in-flight promises stop two workers paying for one domain.
    const inflight = new Map();
    const once = (key, fn) => {
        if (key in cache) return cache[key];
        if (!inflight.has(key)) inflight.set(key, fn().then((v) => { if (!client.disabled || v) cache[key] = v; return v; }));
        return inflight.get(key);
    };

    let done = 0;
    const worker = async () => {
        while (jobs.length && !client.disabled) {
            const { place, site, domain } = jobs.shift();
            const hunter = await once(`domain:${domain}:limit:${limit}:max:${maxEmails}`, () => client.domainSearch(domain, { limit, maxEmails }));

            // Owner name from website but no email for them anywhere -> Email Finder.
            let finder = null;
            const ownerName = site?.owner?.name;
            const haveOwnerEmail = site?.owner?.email
                || hunter?.emails?.some((e) => e.name && ownerName && e.name.toLowerCase() === ownerName.replace(/^(Dr|Mr|Mrs|Ms)\.?\s+/i, '').toLowerCase());
            if (findOwnerEmail && ownerName && !haveOwnerEmail && !client.disabled) {
                finder = await once(`finder:${domain}:${ownerName.toLowerCase()}`, () => client.emailFinder(domain, ownerName));
            }
            out[place.placeKey] = applyHunter(site, hunter, finder);
            done += 1;
            if (onProgress && done % 10 === 0) await onProgress(done, done + jobs.length);
        }
    };
    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));

    log.info?.(`Hunter: ${client.stats.domainSearches} domain searches, ${client.stats.emailFinders} owner emails found, `
        + `${skipped} sites skipped (already had owner + personal email, or no usable domain)`
        + (client.disabled ? ` — stopped early: ${client.disabled}` : ''));
    return { sites: out, stats: { ...client.stats, skipped, disabledReason: client.disabled } };
}
