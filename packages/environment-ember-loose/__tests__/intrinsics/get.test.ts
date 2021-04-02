import { expectTypeOf } from 'expect-type';
import { Globals, resolve } from '@glint/environment-ember-loose/-private/dsl';
import ObjectProxy from '@ember/object/proxy';

let get = resolve(Globals['get']);

// Getting a known key
expectTypeOf(get({}, { foo: 'hello' }, 'foo')).toEqualTypeOf<string>();

// Getting an unknown key
expectTypeOf(get({}, { foo: 'hello' }, 'baz')).toEqualTypeOf<unknown>();

get(
  {
    // @ts-expect-error: invalid named arg
    hello: 'hi',
  },
  {},
  'hi'
);

expectTypeOf(get({}, null, 'name')).toEqualTypeOf<undefined>();
expectTypeOf(get({}, undefined, 'name')).toEqualTypeOf<undefined>();

// Getting a value off an ObjectProxy
declare const proxiedObject: ObjectProxy<{ name: string }>;

expectTypeOf(get({}, proxiedObject, 'content')).toEqualTypeOf<{ name: string } | undefined>();
expectTypeOf(get({}, proxiedObject, 'name')).toEqualTypeOf<string | undefined>();
expectTypeOf(get({}, proxiedObject, 'unknownKey')).toEqualTypeOf<unknown>();

declare const optionalProxiedObject: ObjectProxy<{ name: string }> | undefined;

expectTypeOf(get({}, optionalProxiedObject, 'name')).toEqualTypeOf<string | undefined>();

declare const nullProxiedObject: ObjectProxy<{ name: string }> | null;

expectTypeOf(get({}, nullProxiedObject, 'name')).toEqualTypeOf<string | undefined>();
