// The semantic token legend, pinned to alder's internal/semtok (Types, Modifiers), in order. A
// change there must change this file too; the contract test compares it with the server's.
export const TOKEN_TYPES: readonly string[] = ['namespace', 'type', 'enumMember', 'function', 'method',
  'parameter', 'variable', 'property', 'keyword', 'operator', 'string', 'number', 'comment', 'decorator',
  'tag', 'attribute', 'boolean', 'hole'];

export const TOKEN_MODIFIERS: readonly string[] = ['declaration', 'documentation', 'defaultLibrary'];

// CUSTOM_TYPES are the legend's types VS Code does not know; package.json declares each with
// its superType (so a theme without a rule still colours it) and maps it to a TextMate scope.
export const CUSTOM_TYPES = {
  tag: { superType: 'type', scope: 'entity.name.tag.alder', description: "An element's tag name" },
  attribute: { superType: 'type', scope: 'entity.other.attribute-name.alder', description: "An element's attribute name" },
  boolean: { superType: 'enumMember', scope: 'constant.language.boolean.alder', description: 'True or False' },
  hole: { superType: 'variable', scope: 'variable.language.hole.alder', description: 'A typed hole (?h)' },
} as const;
