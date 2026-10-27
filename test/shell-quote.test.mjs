import test from 'node:test';
import assert from 'node:assert/strict';
import {shellQuote} from '../shared/shell-quote.mjs';
test('displayed helper commands preserve literal paths containing spaces, quotes and shell substitutions',()=>{
  assert.equal(shellQuote("C:\\Drew's files\\$draft`name",'win32'),"'C:\\Drew''s files\\$draft`name'");
  assert.equal(shellQuote("/tmp/Drew's $(touch marker)`name",'linux'),"'/tmp/Drew'\"'\"'s $(touch marker)`name'");
});
