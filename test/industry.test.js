import assert from 'node:assert/strict';
import { classifyIndustry, assessMsme } from '../src/lib/industry.js';

assert.deepEqual(classifyIndustry('Dentist', 'businesses'), { industry:'Healthcare & Dental', industrySource:'google_maps_category', industryConfidence:'category_match' });
assert.equal(classifyIndustry('Law firm', 'dentists').industry, 'Legal Services');
assert.equal(classifyIndustry('', 'plumbers near Toronto').industry, 'Construction & Home Services');
assert.equal(classifyIndustry('Unfamiliar category', 'random query').industry, 'Other / Unclassified');
assert.equal(assessMsme().msmeStatus, 'Not verified');
console.log('INDUSTRY TESTS PASSED');
