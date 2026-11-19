/**
 * Builds the final flat, CSV-friendly lead record (same shape in V1 and V2).
 */
import { emailType } from './websiteExtract.js';
import { scoreLead } from './scoring.js';
import { classifyIndustry, assessMsme } from './industry.js';

export function buildLead(place, site, ctx = {}) {
    const owner = place.owner || site?.owner || null;
    const emails = [...new Set([owner?.email, ...(site?.emails || []), ...(place.emails || [])].filter(Boolean).map((v) => String(v).toLowerCase().trim()))];
    const hunterContacts = site?.hunterContacts || [];
    const contacts = emails.map((email) => {
        const hunter = hunterContacts.find((p) => p.email === email);
        return { email, source: site?.emailSources?.[email] || (hunter ? 'hunter' : 'website'),
            type: hunter?.type || emailType(email), name: hunter?.name || null,
            title: hunter?.position || null, status: hunter?.verification || null,
            confidence: hunter?.confidence ?? null, provenance: hunter?.provenance || null };
    });
    const primaryEmail = (owner?.email && emails.includes(owner.email) ? owner.email : null) || emails[0] || null;

    const lead = {
        businessName: place.name || null,
        category: place.category || null,
        ...classifyIndustry(place.category, ctx.searchTerm || place.searchTerm),
        ...assessMsme(),
        address: place.address || null,
        city: place.city || null,
        state: place.state || null,
        postalCode: place.postalCode || null,
        country: place.countryCode || null,
        phone: place.phone || site?.phones?.[0] || null,
        email: primaryEmail,
        emailType: primaryEmail ? emailType(primaryEmail) : null,
        emailSource: primaryEmail ? (site?.emailSources?.[primaryEmail] || 'website') : null,
        allEmails: emails.join(', ') || null,
        emailCount: emails.length,
        emailAddresses: emails,
        emailContacts: contacts,
        ownerName: owner?.name || null,
        ownerTitle: owner?.title || null,
        ownerEmail: owner?.email || null,
        ownerLinkedIn: owner?.linkedin || null,
        ownerEmailStatus: owner?.emailStatus || null,
        ownerSource: owner?.source || null,
        ownerConfidence: owner?.confidence ?? null,
        ownerStatus: owner?.name ? 'identified' : 'not_found',
        otherDecisionMakers: [...(place.otherContacts || []), ...(site?.ownerCandidates || [])]
            .filter((c) => c.name && c.name !== owner?.name && c.source !== 'email-address')
            .map((c) => [c.name, c.title, c.email].filter(Boolean).join(' – '))
            .filter((v, i, arr) => arr.indexOf(v) === i)
            .slice(0, 5)
            .join(' | ') || null,
        possibleNamedContacts: (site?.ownerCandidates || []).filter((c) => c.source === 'email-address').map((c) => c.name).join(' | ') || null,
        website: place.website || null,
        googleMapsUrl: place.url || null,
        rating: place.rating ?? null,
        reviewsCount: place.reviewsCount ?? null,
        isClaimed: place.isClaimed ?? null,
        priceLevel: place.priceLevel || null,
        openingHours: place.openingHours || null,
        facebook: site?.socials?.facebook || place.facebook || null,
        instagram: site?.socials?.instagram || place.instagram || null,
        linkedin: site?.socials?.linkedin || place.linkedin || null,
        twitter: site?.socials?.twitter || place.twitter || null,
        youtube: site?.socials?.youtube || place.youtube || null,
        tiktok: site?.socials?.tiktok || place.tiktok || null,
        emailPattern: site?.hunter?.pattern || null,
        hunterResults: site?.hunter?.resultsCount ?? null,
        hunterAvailableResults: site?.hunter?.availableResults ?? null,
        hunterTruncated: site?.hunter?.truncated ?? false,
        websiteAudit: site?.audit || null,
        latitude: place.lat ?? null,
        longitude: place.lng ?? null,
        placeId: place.placeId || null,
        searchTerm: ctx.searchTerm || place.searchTerm || null,
        searchLocation: ctx.location || place.searchLocation || null,
        scrapedAt: new Date().toISOString(),
    };
    return { ...lead, ...scoreLead(lead) };
}

export function passesFilters(lead, input) {
    if (input.onlyWithEmail && !lead.email) return false;
    if (input.onlyWithoutWebsite && lead.website) return false;
    if (input.minLeadScore && lead.leadScore < input.minLeadScore) return false;
    if (input.maxRating && lead.rating != null && lead.rating > input.maxRating) return false;
    if (input.excludeKeywords?.length) {
        const hay = `${lead.businessName} ${lead.category}`.toLowerCase();
        if (input.excludeKeywords.some((k) => k && hay.includes(k.toLowerCase()))) return false;
    }
    return true;
}
