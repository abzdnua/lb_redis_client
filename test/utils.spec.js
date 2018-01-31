const assert = require('assert');
const { mergeObjects, fromString } = require('../lib/utils');

describe('#mergeObjects shoudl work correctly', function() {
  it('#mergeObjects should not override existed values with nulls\\undefined', function() {
    assert.deepEqual(
      mergeObjects(
        {
          foo: '123',
          bar: 1,
        },
        {
          foo: null,
          bar: 2,
        }
      ),
      {
        foo: '123',
        bar: 2,
      }
    );

    assert.deepEqual(
      mergeObjects(
        {},
        {
          foo: null,
          bar: 2,
        }
      ),
      {
        bar: 2,
      }
    );

    assert.deepEqual(
      mergeObjects(
        {
          some: '123',
        },
        {
          some: '124',
        }
      ),
      {
        some: '124',
      }
    );

    assert.deepEqual(
      mergeObjects(
        {
          foo: null,
        },
        {
          bar: null,
        }
      ),
      {
        foo: null,
      }
    );
  });

  it('#fromString should works correctly', function() {
    assert.equal(fromString('undefined'), undefined);
    assert.equal(fromString(null), null);
    assert.equal(fromString('123'), '123');
    assert.equal(fromString(192), 192);
    assert.equal(fromString(10.11), 10.11);
  });
});
