# Google Maps Cold Lead Scraper (Custom build)

Finds businesses of any type in any location on Google Maps. It then visits each business's website to collect **emails, owner / founder names, phone numbers and social profiles**, and **audits the site** for SEO, PPC and web-development gaps. Each lead gets a **score from 0 to 100** and ready-made **pitch angles** for cold outreach.

It is built from scratch with Crawlee and Playwright and **does not call any Apify Store actors**. You pay only for compute and proxy.

## How it works

| Stage | Engine | What happens |
|---|---|---|
| 1. Google Maps | PlaywrightCrawler (Chrome) | Opens `google.com/maps/search/<term> in <location>`, scrolls the results feed, then opens every listing and extracts name, category, address, phone, website, rating, reviews, opening hours, coordinates, place ID and whether the profile is **unclaimed**. |
| Deep search (optional) | OpenStreetMap geocoder | Splits the location's bounding box into an N×N grid and searches each cell. This gets past Google's limit of about 120 results per search, the same idea as Apify's own scraper. |
| 2. Websites | CheerioCrawler (fast HTTP) | Fetches the homepage plus the best About, Team and Contact pages. It extracts emails, including Cloudflare-protected and `name [at] domain [dot] com` forms. It reads `tel:` links, socials, and owner names from schema.org JSON-LD, "Jane Smith, Founder" text patterns, team cards and "founded by…" sentences. |
| 3. Audit + score | Built in | Checks HTTPS, mobile viewport, title and meta description, H1, schema, Google Analytics and GTM, **Google Ads tag**, **Meta Pixel**, CMS, a stale © year, load time and whether the site is down. Lead score, tier (Hot, Warm or Cold), recommended services and pitch angles are calculated from these checks. |

Results are pushed to the dataset as soon as they are final, the same way Apify's own scrapers work. Businesses without a website are saved straight away. Progress is persisted, so runs survive migrations, and you get live status messages and a `RUN_SUMMARY` record in the key-value store.

## Hunter.io enrichment (Stage 2.5)

After the website crawl, each business website is reduced to its registrable domain
(`https://www.shop.brightsmile.co.uk/about` → `brightsmile.co.uk`) and sent to Hunter's **Domain Search**.
Hunter returns the people and emails it has indexed for that domain, with their position, seniority,
department, LinkedIn and verification status. The scraper then:

- picks the most senior named person (owner / founder / CEO / executive) as `ownerName` + `ownerEmail` when the website didn't reveal a confident owner,
- keeps a website-found owner and uses Hunter (or the **Email Finder**, if `hunterFindOwnerEmail` is on) to get that person's email,
- adds the remaining Hunter contacts to `otherDecisionMakers` and `allEmails`,
- skips social pages and site builders (Facebook, Linktree, wixsite, business.site…) so no credits are wasted,
- caches results per domain in the persisted state, so chains and resumed runs never pay twice,
- stops cleanly on an invalid key or exhausted credits instead of failing the run.

`hunterMode`: `fallback` (default) only calls Hunter when the website didn't already give a named owner with a personal email; `always` calls it for every website; `off` disables it.
Set the key in the `hunterApiKey` input (stored as a secret) or the `HUNTER_API_KEY` environment variable.

New output fields: `emailSource` (website / hunter), `emailPattern` (e.g. `{first}.{last}`), `ownerEmailStatus` (valid / accept_all / unknown), `hunterResults`.

## Input example

```json
{
  "searchTerms": ["dentist", "orthodontist"],
  "locations": ["Mississauga, ON, Canada", "Brampton, ON, Canada"],
  "maxPlacesPerSearch": 100,
  "deepSearch": true,
  "gridSize": 3,
  "scrapeWebsites": true,
  "maxPagesPerWebsite": 4,
  "onlyWithEmail": false,
  "minLeadScore": 35,
  "hunterApiKey": "YOUR_HUNTER_KEY",
  "hunterMode": "fallback",
  "excludeKeywords": ["Walmart", "Shoppers Drug Mart"],
  "proxyConfiguration": { "useApifyProxy": true, "apifyProxyGroups": ["RESIDENTIAL"] }
}
```

## Output (one row per business)

`businessName, category, address, city, state, postalCode, country, phone, email, emailType (personal/generic), allEmails, ownerName, ownerTitle, ownerEmail, ownerConfidence, ownerSource, otherDecisionMakers, website, googleMapsUrl, rating, reviewsCount, isClaimed, openingHours, facebook, instagram, linkedin, twitter, youtube, tiktok, websiteAudit{…}, latitude, longitude, placeId, searchTerm, searchLocation, leadScore, leadTier, recommendedServices, pitchAngles, scrapedAt`

The dataset has three ready-made views: **Cold leads**, **All contact details** and **Website audit**. You can export any of them to CSV or Excel and import it straight into Instantly, Lemlist, Apollo, HubSpot or another tool.

### Lead score at a glance

| Signal | Points | Service to pitch |
|---|---|---|
| No website on Google Maps | +30 | Web Development, Local SEO |
| Website down or error | +25 | Web Development |
| Unclaimed Google Business Profile | +12 | Local SEO |
| No mobile viewport / no HTTPS / © 3+ years old | +10 / +8 / +6 | Web Development |
| Missing title or meta description, thin content | +4 to +6 | SEO |
| No Google Ads tag **and** no Meta Pixel | +8 | PPC |
| No GA or GTM | +5 | Analytics & Tracking |
| Rating below 4.0, fewer than 25 reviews | +8 each | Reputation, Local SEO |
| Has email, personal email, owner name, phone | up to +14 | (reachability) |

Leads without an email have their score multiplied by 0.75. Hot means 55 or more, Warm means 35 or more.

## Deploy to Apify

```bash
npm i -g apify-cli
apify login              # paste your Apify API token
cd v2-custom-maps-lead-scraper
apify push               # builds the Docker image and creates the actor in your account
```

Then open **Apify Console → Actors → Google Maps Cold Lead Scraper → Start**.

Run locally with `npm install && apify run`. Outside the Apify image, set `CHROME_EXECUTABLE_PATH` if Playwright's Chrome isn't installed.

## Tips

* **Proxy:** Google rate-limits datacenter IPs. For runs of more than a few hundred places, use the `RESIDENTIAL` Apify Proxy group.
* **Memory:** 4 GB with concurrency 4 is a good default. For big runs, raise memory and `maxConcurrency` together.
* **Selectors:** Google changes Maps class names from time to time. The extractor relies mostly on stable attributes (`data-item-id`, `aria-label`, `role="feed"`) with fallbacks. If a field comes back empty across a run, update `extractPlace()` in `src/maps.js`.
* **Owner names** are heuristic and come with `ownerConfidence`. JSON-LD and team cards are the most reliable sources. Many small-business sites never name the owner, so expect roughly 25–50% coverage depending on the niche.
* Run the tests with `npm test`. They cover email, owner and audit extraction and a mock Maps place page.

## Compliance

Scraping public business listings is common practice, but Google's Terms of Service restrict automated access, so use reasonable volumes. For outreach, follow the law where the recipients are, such as **CASL** (Canada), **CAN-SPAM** (US) or **GDPR/PECR** (EU/UK). In general, contact role-relevant, publicly listed business addresses, identify yourself, and include a working unsubscribe.

## Expanded email collection (updated)

- Hunter mode defaults to **always** so every eligible domain is checked, even where an owner is already known. This may use more Hunter credits; choose `fallback` to save credits.
- `hunterLimit` is the **page size** (1–100); `hunterMaxEmails` is the maximum total results across pages (default 100, maximum 1000). Domain Search uses `offset` pagination and caches the result by domain and page settings.
- The default Apify **Cold leads** view now shows `emailCount` and `allEmails`; `email` is kept as the primary outreach email for backward compatibility. `emailAddresses` and `emailContacts` are structured dataset fields with sources and available Hunter metadata.
- Hunter may provide only generic addresses (e.g. `info@`, `hr@`). This does **not** establish a named business owner. Website article authors and names inferred only from email usernames are no longer promoted as verified owners. `ownerName` stays empty where no supported owner evidence was found; potential names can appear among other contacts.
- Each additional Hunter API page can use credits. This scraper cannot guarantee every email on the Internet or an owner name for every business. Hunter API coverage, site access, and public records determine availability.

### Deploying the modified files

Copy the contents of this project into the cloned GitHub repository (preserve its `.git` directory), review changes and secrets, run `npm install` and `npm test`, then commit and push. In the Apify Actor connected to that Git repository, rebuild the Actor and run a small test with `hunterMode: "always"`, `hunterLimit: 100`, `hunterMaxEmails: 100`. Enter the Hunter key via the Actor's secret input or `HUNTER_API_KEY` environment variable; never commit it to GitHub. Existing Apify datasets are not retroactively changed.


## Industry and MSME information

Each lead includes `industry` (a broad sector), `industrySource` and `industryConfidence`. The classifier checks the Google Maps category first, then the search term; when neither matches, it uses `Other / Unclassified`. It does not assign official NAICS/NIC/NACE codes. You can see these columns in the main **Cold leads** dataset view.

The Actor **can discover** local small and medium enterprises using relevant Google Maps search terms, but **cannot currently verify** MSME status. `msmeStatus` is `Not verified`, `businessSize` is `Unknown`, and `msmeEvidence` explains why. Official classifications differ by jurisdiction and normally require employee headcount, revenue/turnover, investment or registration evidence that Google Maps/Hunter do not provide. Do not infer MSME status from review count, number of branches or a small website.
