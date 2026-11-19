import assert from 'node:assert/strict';
import { selectPrimaryEmail } from '../src/lib/emailPriority.js';
const pick = (contacts, owner) => selectPrimaryEmail(contacts, owner);

// Hunter decision makers win even when generic website email was discovered first.
assert.deepEqual(pick([
    { email: 'info@company.ca', type: 'generic', source: 'website' },
    { email: 'employee@company.ca', type: 'personal', name: 'Alia Kim' },
    { email: 'director@company.ca', type: 'personal', name: 'Sam Patel', title: 'Managing Director', decisionMaker: true },
]), { email: 'director@company.ca', priority: 'decision_maker' });
// Hunter explicit decision maker flag with no title.
assert.equal(pick([
    { email: 'contact@a.ca', type: 'generic' },
    { email: 'tina@a.ca', type: 'personal', decisionMaker: true },
]).email, 'tina@a.ca');
// Named Hunter people beat a generic company inbox.
assert.deepEqual(pick([
    { email: 'hello@company.ca', type: 'generic' },
    { email: 'amy@company.ca', type: 'personal', name: 'Amy Lee' },
]), { email: 'amy@company.ca', priority: 'person' });
// Generic is last resort.
assert.deepEqual(pick([{ email: 'info@bristoldental.ca', type: 'generic' }, { email: 'hr@bristoldental.ca', type: 'generic' }]),
    { email: 'info@bristoldental.ca', priority: 'generic' });
// Website owner may be a decision maker even without a Hunter record.
assert.equal(pick([
    { email: 'info@a.ca', type: 'generic' }, { email: 'jane@a.ca', type: 'personal' },
], { name: 'Jane Doe', title: 'Founder', email: 'jane@a.ca' }).email, 'jane@a.ca');
// Invalid emails must never be selected even if labelled decision maker.
assert.deepEqual(pick([
    { email: 'manager@company.ca', type: 'personal', name: 'M G', title: 'CEO', status: 'invalid' },
    { email: 'info@company.ca', type: 'generic' },
]), { email: 'info@company.ca', priority: 'generic' });
// Don't output malformed strings mistakenly captured as emails.
assert.deepEqual(pick([{ email: '647-372-2596hello@company.ca', type: 'personal' }, { email: 'info@company.ca', type: 'generic' }]),
    { email: 'info@company.ca', priority: 'generic' });
// If no addresses are present, return nulls.
assert.deepEqual(pick([]), { email: null, priority: null });
console.log('Primary email priority tests passed');
