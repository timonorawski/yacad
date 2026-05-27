# YACAD DAG Language Reference

This reference describes the JSON DAG document consumed by `buildGraph` and used by the studio editor.

## Document shape

Every node uses this shape:

```json
{
  "type": "<node-type>",
  "params": { "...": "..." },
  "children": [
    { "type": "..." }
  ]
}
```

- `type`: required string identifying the operation.
- `params`: optional object; defaults and validation are type-specific.
- `children`: optional array of child nodes.

## Node type summary

POC-supported node types:

- `box` (3D primitive, no children)
- `sphere` (3D primitive, no children)
- `cylinder` (3D primitive, no children)
- `translate` (3D transform, exactly one 3D child)
- `rotate` (3D transform, exactly one 3D child)
- `union` (3D boolean, one or more 3D children)
- `difference` (3D boolean, one or more 3D children)

## Primitive nodes

### `box`

```json
{
  "type": "box",
  "params": { "size": [20, 20, 20], "center": true }
}
```

Parameters:

- `size`: required positive vector `[x, y, z]`
- `center`: optional boolean, default `false`

### `sphere`

```json
{
  "type": "sphere",
  "params": { "radius": 10, "segments": 48 }
}
```

Parameters:

- `radius`: required positive number
- `segments`: optional integer >= 3, default `32`

### `cylinder`

```json
{
  "type": "cylinder",
  "params": { "height": 30, "radius": 8, "segments": 64, "center": true }
}
```

Parameters:

- `height`: required positive number
- `radius`: required positive number
- `segments`: optional integer >= 3, default `32`
- `center`: optional boolean, default `false`

## Transform nodes

### `translate`

```json
{
  "type": "translate",
  "params": { "offset": [15, 0, 0] },
  "children": [
    { "type": "box", "params": { "size": [10, 10, 10], "center": true } }
  ]
}
```

Parameters:

- `offset`: required vector `[x, y, z]`

### `rotate`

```json
{
  "type": "rotate",
  "params": { "angles": [90, 0, 0] },
  "children": [
    { "type": "cylinder", "params": { "height": 30, "radius": 6, "segments": 64, "center": true } }
  ]
}
```

Parameters:

- `angles`: required vector in degrees `[x, y, z]`

## Boolean nodes

### `union`

```json
{
  "type": "union",
  "children": [
    { "type": "box", "params": { "size": [20, 20, 10], "center": true } },
    {
      "type": "translate",
      "params": { "offset": [0, 0, 10] },
      "children": [
        { "type": "box", "params": { "size": [10, 10, 10], "center": true } }
      ]
    }
  ]
}
```

### `difference`

```json
{
  "type": "difference",
  "children": [
    { "type": "box", "params": { "size": [30, 30, 30], "center": true } },
    { "type": "sphere", "params": { "radius": 19, "segments": 48 } }
  ]
}
```

## Validation behavior

`buildGraph` validates documents before evaluation:

- Unknown node types throw an error.
- Invalid parameter types throw an error.
- Transform nodes require exactly one child.
- Boolean nodes require one or more children.
- Primitive nodes require zero children.

## Determinism and hashing

- Semantic node hashes are computed from `type + canonical(params) + ordered child hashes`.
- Stable canonicalization is critical for cache hits.
- Node `id` is authoring identity and is not part of the semantic hash.
