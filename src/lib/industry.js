/**
 * Broad, transparent lead segmentation based on the Google Maps category.
 * This is not a registered industry code (NAICS/NACE/NIC), nor proof of MSME status.
 * Order matters: specific categories must appear before broad ones.
 */
const RULES = [
    ['Healthcare & Dental', /dentist|dental|orthodont|periodont|endodont|oral surgeon|teeth whitening|denture/],
    ['Healthcare & Medical', /hospital|medical|physician|doctor|clinic|pharmacy|physiotherap|chiropract|optomet|optician|veterinar|health care|healthcare|therap|psycholog|diagnostic|laborator|nursing|pediatric/],
    ['Legal Services', /law firm|lawyer|attorney|legal service|notary|solicitor|advocate|barrister/],
    ['Accounting & Financial Services', /accountant|accounting|bookkeep|tax prepar|financial advisor|financial planner|investment advisor|insurance agenc|auditor|chartered accountant|cpa firm/],
    ['Real Estate', /real estate|realtor|property manage|estate agenc|property dealer|brokerage|leasing agent/],
    ['Construction & Home Services', /construction|contractor|roofing|plumb|electrician|hvac|heating|air conditioning|renovation|remodel|painter|flooring|landscap|pest control|cleaning service|handyman|glass repair|carpenter|masonry/],
    ['Hospitality & Food Services', /restaurant|cafe|coffee shop|bakery|cater|hotel|motel|hostel|resort|bar and grill|food truck|pub|lodging/],
    ['Beauty & Personal Care', /salon|barber|spa|beauty|cosmetic|nail studio|hairdresser|massage|skin care|tattoo/],
    ['Automotive & Transportation', /auto repair|car repair|car dealer|automotive|mechanic|tire shop|vehicle|transport|logistic|trucking|taxi|limousine|car wash|moving company|courier/],
    ['Education & Training', /school|college|university|tutor|education|training center|academy|daycare|preschool|child care|learning center/],
    ['Technology & IT Services', /software|information technology|it service|computer repair|web develop|app develop|cybersecurity|tech consult|digital service/],
    ['Marketing & Creative Services', /marketing|advertising|seo agenc|design studio|graphic design|photograph|video production|public relation|branding agenc/],
    ['Retail & E-commerce', /retail|store|shop|boutique|clothing|grocery|supermarket|jewel|furniture|gift shop|pet store|florist|e-commerce|electronics store|hardware store/],
    ['Manufacturing & Industrial', /manufactur|factory|fabricat|industrial|machine shop|textile mill|metalwork|packaging company/],
    ['Professional & Business Services', /consult|recruit|staffing|employment agenc|business service|printing service|translation service/],
    ['Fitness & Recreation', /gym|fitness|yoga|pilates|sports club|recreation|dance studio|martial art/],
    ['Agriculture & Food Production', /farm|agricultur|nursery|food process|dairy producer|fishery|horticultur/],
];

export function classifyIndustry(category, searchTerm) {
    const primary = typeof category === 'string' ? category.trim() : '';
    const secondary = typeof searchTerm === 'string' ? searchTerm.trim() : '';
    for (const [source, value] of [['google_maps_category', primary], ['search_term', secondary]]) {
        if (!value) continue;
        for (const [industry, regex] of RULES) {
            if (regex.test(value.toLowerCase())) {
                return { industry, industrySource: source, industryConfidence: source === 'google_maps_category' ? 'category_match' : 'search_term_match' };
            }
        }
    }
    return { industry: 'Other / Unclassified', industrySource: null, industryConfidence: 'unclassified' };
}

/** The scraper does not collect employment, turnover or registered MSME evidence. */
export function assessMsme() {
    return { msmeStatus: 'Not verified', businessSize: 'Unknown', msmeEvidence: 'Employee count, turnover and official registration not collected' };
}
