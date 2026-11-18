import assert from 'node:assert/strict';
import { domainForHunter, enrichWithHunter, applyHunter, needsHunter } from '../src/lib/hunter.js';
import { extractFromHtml, mergeSiteResults } from '../src/lib/websiteExtract.js';
import { buildLead } from '../src/lib/output.js';

const quiet = { info() {}, warning() {}, error() {}, debug() {} };

// ---- 1. Domain extraction ----
assert.equal(domainForHunter('https://www.brightsmile.ca/about'), 'brightsmile.ca');
assert.equal(domainForHunter('http://shop.kolkatasweets.co.in/?utm=gmb'), 'kolkatasweets.co.in');
assert.equal(domainForHunter('brightsmile.co.uk'), 'brightsmile.co.uk');
assert.equal(domainForHunter('https://www.facebook.com/brightsmile'), null, 'social pages skipped');
assert.equal(domainForHunter('https://joe.wixsite.com/plumbing'), null, 'site-builder subdomains skipped');
assert.equal(domainForHunter('https://linktr.ee/salon'), null);
assert.equal(domainForHunter(null), null);

// ---- Mock Hunter API ----
const calls = [];
function mockFetch(routes) {
    return async (url) => {
        const u = new URL(url);
        calls.push(`${u.pathname.split('/').pop()}:${u.searchParams.get('domain')}`);
        const r = routes(u);
        return { ok: r.status === 200, status: r.status, statusText: 'x', json: async () => r.body };
    };
}
const domainSearchBody = {
    data: {
        domain: 'genericdental.ca', organization: 'Generic Dental', pattern: '{first}', accept_all: false,
        emails: [
            { value: 'info@genericdental.ca', type: 'generic', confidence: 90, first_name: null, last_name: null, position: null, seniority: null, department: null, verification: { status: 'valid' } },
            { value: 'amy@genericdental.ca', type: 'personal', confidence: 82, first_name: 'Amy', last_name: 'Lee', position: 'Hygienist', seniority: 'junior', department: null, verification: { status: 'valid' } },
            { value: 'rahul@genericdental.ca', type: 'personal', confidence: 94, first_name: 'Rahul', last_name: 'Mehta', position: 'Owner & Principal Dentist', seniority: 'executive', department: 'executive', linkedin: 'https://linkedin.com/in/rahulmehta', verification: { status: 'valid' } },
        ],
    },
    meta: { results: 3 },
};

// ---- 2. Website only had info@ and no names -> Hunter supplies the owner ----
const genericHtml = `<html><body><h1>Generic Dental</h1><a href="mailto:info@genericdental.ca">Email us</a></body></html>`;
const genericSite = mergeSiteResults([{ ...extractFromHtml(genericHtml, 'https://genericdental.ca/'), url: 'https://genericdental.ca/', isHomepage: true }], 'https://genericdental.ca/');
assert.equal(genericSite.owner, null, 'no owner from a generic-only site');
assert.equal(needsHunter(genericSite, 'fallback'), true);

// ---- 3. Website named an owner but showed no email for her -> Email Finder ----
const namedHtml = `<html><body><h3>Dr. Priya Sharma</h3><p>Owner and Lead Dentist</p><a href="mailto:hello@brightsmile.ca">x</a></body></html>`;
const namedSite = mergeSiteResults([{ ...extractFromHtml(namedHtml, 'https://www.brightsmile.ca/'), url: 'https://www.brightsmile.ca/', isHomepage: true }], 'https://www.brightsmile.ca/');
assert.equal(namedSite.owner.name, 'Dr. Priya Sharma');
assert.equal(namedSite.owner.email, null);

const places = [
    { placeKey: 'a', name: 'Generic Dental', website: 'https://genericdental.ca/' },
    { placeKey: 'c', name: 'Generic Dental 2nd branch', website: 'http://www.genericdental.ca/branch' },
    { placeKey: 'b', name: 'Bright Smile', website: 'https://www.brightsmile.ca/' },
    { placeKey: 'd', name: 'FB only salon', website: 'https://facebook.com/salon' },
];
const sites = { a: genericSite, c: genericSite, b: namedSite, d: null }; // a & c same domain, processed concurrently
const cache = {};
const { sites: out, stats } = await enrichWithHunter(places, sites, {
    apiKey: 'test', mode: 'fallback', cache, log: quiet, concurrency: 2,
    fetchImpl: mockFetch((u) => {
        const domain = u.searchParams.get('domain');
        if (u.pathname.endsWith('domain-search') && domain === 'genericdental.ca') return { status: 200, body: domainSearchBody };
        if (u.pathname.endsWith('domain-search')) return { status: 200, body: { data: { emails: [], pattern: '{first}.{last}' }, meta: { results: 0 } } };
        if (u.pathname.endsWith('email-finder')) {
            assert.equal(u.searchParams.get('first_name'), 'Priya');
            assert.equal(u.searchParams.get('last_name'), 'Sharma');
            return { status: 200, body: { data: { email: 'priya.sharma@brightsmile.ca', score: 91, first_name: 'Priya', last_name: 'Sharma', verification: { status: 'valid' } } } };
        }
        return { status: 404, body: {} };
    }),
});
console.log('Hunter calls:', calls, stats);

assert.equal(out.a.owner.name, 'Rahul Mehta', 'Hunter picks the executive/owner, not the hygienist');
assert.equal(out.a.owner.email, 'rahul@genericdental.ca');
assert.equal(out.a.owner.source, 'hunter');
assert.ok(out.a.emails.includes('amy@genericdental.ca'));
assert.equal(out.b.owner.name, 'Dr. Priya Sharma', 'website owner kept');
assert.equal(out.b.owner.email, 'priya.sharma@brightsmile.ca', 'Email Finder filled the owner email');
assert.equal(calls.filter((c) => c === 'domain-search:genericdental.ca').length, 1, 'same domain searched once (cache)');
assert.ok(!calls.some((c) => c.includes('facebook')), 'facebook never sent to Hunter');

const lead = buildLead({ name: 'Generic Dental', website: 'https://genericdental.ca/' }, out.a);
assert.equal(lead.ownerName, 'Rahul Mehta');
assert.equal(lead.email, 'rahul@genericdental.ca');
assert.equal(lead.emailType, 'personal');
assert.equal(lead.emailSource, 'hunter');
assert.equal(lead.ownerLinkedIn, 'https://linkedin.com/in/rahulmehta');
assert.equal(lead.emailPattern, '{first}');
console.log('lead:', { ownerName: lead.ownerName, ownerTitle: lead.ownerTitle, email: lead.email, emailSource: lead.emailSource, others: lead.otherDecisionMakers });

// ---- 4. Bad key / out of credits stops the run without throwing ----
calls.length = 0;
const r401 = await enrichWithHunter(
    [{ placeKey: 'x', website: 'https://one.com' }, { placeKey: 'y', website: 'https://two.com' }],
    { x: null, y: null },
    { apiKey: 'bad', mode: 'always', log: quiet, concurrency: 1, fetchImpl: mockFetch(() => ({ status: 401, body: { errors: [{ details: 'No valid API key provided.' }] } })) },
);
assert.equal(calls.length, 1, 'stops after the first 401');
assert.match(r401.stats.disabledReason, /401/);

// ---- 5. Transient 429 is retried ----
let n = 0;
const r429 = await enrichWithHunter([{ placeKey: 'z', website: 'https://retry.com' }], { z: null }, {
    apiKey: 'k', mode: 'always', log: quiet,
    fetchImpl: async () => (++n === 1
        ? { ok: false, status: 429, statusText: 'Too Many Requests', json: async () => ({ errors: [{ details: 'Too many requests' }] }) }
        : { ok: true, status: 200, json: async () => domainSearchBody }),
});
assert.equal(r429.sites.z.owner.name, 'Rahul Mehta', 'succeeded after retry');

// ---- 6. Owner inferred from a first.last email when no name on the site ----
const emailOnly = mergeSiteResults([{ ...extractFromHtml('<a href="mailto:sanjay.roy@roylaw.in">mail</a>', 'https://roylaw.in/'), url: 'https://roylaw.in/', isHomepage: true }], 'https://roylaw.in/');
assert.equal(emailOnly.owner.name, 'Sanjay Roy');
assert.equal(emailOnly.owner.source, 'email-address');

// applyHunter with no data leaves the site untouched
assert.deepEqual(applyHunter(namedSite, null).owner, namedSite.owner);
console.log('hunter tests passed ✔');
