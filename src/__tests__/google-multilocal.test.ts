import { getGoogleLocalsLimit, normalizeGoogleLocationId, toSlugBase } from '../lib/integrations/google/multilocal';

let pass = 0;
let fail = 0;

function assert(label: string, condition: boolean) {
  if (condition) {
    pass += 1;
    console.log(`PASS ${label}`);
  } else {
    fail += 1;
    console.error(`FAIL ${label}`);
  }
}

assert('starter_29 limit is 2', getGoogleLocalsLimit({ planCode: 'starter_29' }) === 2);
assert('starter_49 limit is 5', getGoogleLocalsLimit({ planCode: 'starter_49' }) === 5);
assert('pro_149 limit is 10', getGoogleLocalsLimit({ planCode: 'pro_149' }) === 10);
assert('legacy pro plan resolves to 10', getGoogleLocalsLimit({ plan: 'pro' }) === 10);

assert(
  'slug uses city when provided',
  toSlugBase('Can Xef', 'Barcelona') === 'can-xef-barcelona',
);
assert(
  'slug removes accents and symbols',
  toSlugBase('Làctics & Còctels', null) === 'lactics-coctels',
);

assert(
  'normalize location id from full path',
  normalizeGoogleLocationId('accounts/123/locations/456') === '456',
);
assert(
  'normalize location id from locations prefix',
  normalizeGoogleLocationId('locations/999') === '999',
);

console.log(`\nresults: ${pass}/${pass + fail} assertions passed`);
if (fail > 0) process.exit(1);
