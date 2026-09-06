import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  comparePhone,
  compareUrl,
  compareShortText,
  compareProse,
  compareDocuments,
} from '../descriptive.ts';

test('phone: format-insensitive, country-code-insensitive match', () => {
  assert.equal(comparePhone('608-266-4675', '(608) 266-4675').verdict, 'match');
  assert.equal(comparePhone('1-800-362-3002', '800-362-3002').verdict, 'match');
  assert.equal(comparePhone('608-266-4675', '608-266-9999').verdict, 'miss');
});

test('phone: not-scored when the candidate omits it', () => {
  assert.equal(comparePhone('608-266-4675', undefined).verdict, 'not-scored');
});

test('url: scheme / www / trailing slash are ignored; same host is near', () => {
  assert.equal(compareUrl('https://www.example.gov/apply/', 'http://example.gov/apply').verdict, 'match');
  assert.equal(compareUrl('https://example.gov/apply', 'https://example.gov/programs/apply').verdict, 'near');
  assert.equal(compareUrl('https://example.gov/apply', 'https://elsewhere.org/apply').verdict, 'miss');
});

test('short text: punctuation/case-insensitive equality is a match; reworded is near', () => {
  assert.equal(compareShortText('name', 'Housing Choice Voucher (Section 8)', 'housing choice voucher section 8').verdict, 'match');
  assert.equal(
    compareShortText('administeredBy', 'Wisconsin Department of Health Services', 'Wisconsin Dept. of Health Services').verdict,
    'near',
  );
  assert.equal(compareShortText('name', 'FoodShare Wisconsin', 'Weatherization Assistance Program').verdict, 'miss');
});

test('prose: paraphrase scores match/near, unrelated scores miss', () => {
  const verified = 'Money is loaded onto a QUEST card each month that you use like a debit card at grocery stores.';
  assert.equal(
    compareProse('summary', verified, 'Each month, funds are loaded on a QUEST card you use like a debit card at grocery stores.').verdict,
    'match',
  );
  assert.equal(compareProse('summary', verified, 'A voucher that pays part of your rent directly to a private landlord.').verdict, 'miss');
});

test('requiredDocuments: equal sets match, half-overlap is near', () => {
  assert.equal(
    compareDocuments(['Photo ID', 'Proof of income'], ['proof of income', 'photo id']).verdict,
    'match',
  );
  assert.equal(
    compareDocuments(['Photo ID', 'Proof of income', 'Lease'], ['Photo ID', 'Proof of income']).verdict,
    'near',
  );
  assert.equal(compareDocuments(['Lease'], undefined).verdict, 'not-scored');
});
