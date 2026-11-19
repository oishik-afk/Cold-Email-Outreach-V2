/**
 * Choose a single outreach address without losing any of the collected emails.
 * Priority: decision maker -> named person -> generic inbox.
 * Hunter `decision_maker` is honoured; senior management titles are also considered.
 * A website owner explicitly identified by the crawler counts as a decision maker.
 */
const DECISION_TITLE = /\b(owner|co-?owner|founder|co-?founder|ceo|chief executive|president|proprietor|managing (director|partner)|principal|partner|director|general manager|chief (operating|financial|marketing|technology|information) officer|c[oftim]o)\b/i;
const GENERIC_LOCAL = /^(info|contact|hello|hi|admin|office|support|sales|enquiries|enquiry|inquiries|inquiry|mail|team|booking|bookings|reception|service|services|help|marketing|billing|accounts|careers|jobs|hr|appointments|frontdesk|general|orders|customerservice|webmaster)([._-]?\d+)?$/i;
const INVALID_STATUSES = new Set(['invalid', 'undeliverable']);
const VALID_EMAIL = /^[a-z0-9][a-z0-9._%+-]*@(?:[a-z0-9-]+\.)+[a-z]{2,24}$/i;

function validEmail(email) {
    return typeof email === 'string' && VALID_EMAIL.test(email.trim()) && !/\s/.test(email)
        && !/^(?:\+?1[-.]?)?\d{3}[-.]?\d{3}[-.]?\d{4}/.test(email.split('@')[0]);
}

function isGeneric(contact) {
    const local = contact.email.split('@')[0];
    return contact.type === 'generic' || GENERIC_LOCAL.test(local);
}

/**
 * @param {Array<object>} contacts merged `emailContacts`, with Hunter metadata
 * @param {object|null} owner owner recognized on website or through Hunter
 * @returns {{email:string|null, priority:string|null}} primary address and its evidence tier
 */
export function selectPrimaryEmail(contacts, owner = null) {
    const ownerEmail = validEmail(owner?.email) ? owner.email.trim().toLowerCase() : null;
    const ownerIsDecisionMaker = Boolean(owner?.name && owner?.title && DECISION_TITLE.test(owner.title));
    const ranked = contacts
        .filter((c) => validEmail(c.email) && !INVALID_STATUSES.has(String(c.status || '').toLowerCase()))
        .map((contact, index) => {
            const c = { ...contact, email: contact.email.trim().toLowerCase() };
            const generic = isGeneric(c);
            const identifiedOwner = ownerIsDecisionMaker && c.email === ownerEmail;
            const explicitDecisionMaker = !generic && (
                identifiedOwner || c.decisionMaker === true
                || (Boolean(c.name) && DECISION_TITLE.test(c.title || c.position || ''))
            );
            const namedPerson = !generic && (Boolean(c.name) || c.type === 'personal' || identifiedOwner);
            const tier = explicitDecisionMaker ? 0 : namedPerson ? 1 : 2;
            const verification = c.status === 'valid' ? 2 : c.status === 'accept_all' ? 1 : 0;
            const confidence = Number.isFinite(Number(c.confidence)) ? Number(c.confidence) : 0;
            const ownerMatch = identifiedOwner ? 1 : 0;
            return { c, tier, verification, confidence, ownerMatch, index };
        })
        .sort((a, b) => a.tier - b.tier
            || b.ownerMatch - a.ownerMatch
            || b.verification - a.verification
            || b.confidence - a.confidence
            || a.index - b.index);
    if (!ranked.length) return { email: null, priority: null };
    return {
        email: ranked[0].c.email,
        priority: ['decision_maker', 'person', 'generic'][ranked[0].tier],
    };
}
