const { RelationsFinder, RelationType } = require("@saltcorn/common-code");

/**
 * Relation path documentation included in LLM system prompts (viewgen, builder-gen).
 *
 * TWO FORMATS EXIST:
 *
 * New format (always generate this):
 *   view: "viewname"  +  relation: ".sourcetable.segment1.segment2..."
 *
 *   Segment types:
 *     Outbound FK (to parent):    FK field name alone,         e.g. trip_id
 *     Inbound FK  (child rows):   childtable$fkfield,          e.g. packing_items$trip_id
 *
 *   Examples:
 *     .trips.packing_items$trip_id            ChildList:    all packing_items for a trip
 *     .packing_items.trip_id                  ParentShow:   the trip that owns a packing item
 *     .artists.artist_plays_on_album$artist.album  ChildList through a join table
 *     .users.orders$user_id.order_lines$order_id   RelationPath: multi-level
 *
 * Legacy format (may appear in existing configs — do not generate, understand only):
 *   The type and path are encoded together in the view field, no separate relation field.
 *     "Own:viewname"                     → same table, no relation
 *     "ParentShow:viewname.table.fkfield" → outbound FK to parent
 *     "ChildList:viewname.table.inbkey"  → inbound FK, one-to-many
 *     "OneToOneShow:viewname.table.inbkey" → inbound FK, unique
 *     "Independent:viewname"             → no FK relationship
 *
 * Relation types by new-format path structure:
 *   Own          – zero segments, source and target are the same table
 *   ParentShow   – single outbound-FK segment
 *   OneToOneShow – single inbound-FK segment on a unique field
 *   ChildList    – one or more inbound-FK segments (may mix outbound for join tables)
 *   RelationPath – complex multi-level path mixing both segment types
 */
const RELATION_PATH_DOC = `
## Relation paths

Relation paths connect a view_link column or embedded view (type "view") segment to its
target view. There are two formats — **new** (preferred) and **legacy** (read-only).

---

### New format (always use this when generating or updating)

Two separate fields:
- \`view\`: just the view name, e.g. \`"packing_items_list"\`
- \`relation\`: a dot-separated path string, e.g. \`".trips.packing_items$trip_id"\`

**Path string format:** \`.sourcetable.segment1.segment2...\`

Segment types:
- **Outbound FK** (navigate to a parent): FK field name alone — e.g. \`trip_id\`
- **Inbound FK** (collect child rows): \`childtable$fkfield\` — e.g. \`packing_items$trip_id\`

Examples:
| relation string | type | meaning |
|---|---|---|
| \`.trips.packing_items$trip_id\` | ChildList | all packing_items for a trip |
| \`.packing_items.trip_id\` | ParentShow | the trip that owns a packing_item |
| \`.artists.artist_plays_on_album$artist.album\` | ChildList | albums via join table |
| \`.users.orders$user_id.order_lines$order_id\` | RelationPath | multi-level |

---

### Legacy format (you may encounter this in existing configs — do not generate it)

The type and path are encoded together inside the \`view\` field as a colon-prefixed string.
There is no separate \`relation\` field.

| legacy view field | equivalent new relation |
|---|---|
| \`"Own:viewname"\` | \`view: "viewname"\`, no relation |
| \`"ParentShow:viewname.table.fkfield"\` | \`relation: ".sourcetable.fkfield"\` |
| \`"ChildList:viewname.table.inbkey"\` | \`relation: ".sourcetable.childtable$inbkey"\` |
| \`"OneToOneShow:viewname.table.inbkey"\` | \`relation: ".sourcetable.childtable$inbkey"\` |
| \`"Independent:viewname"\` | \`view: "viewname"\`, no relation |

When you read an existing view config and see a legacy \`view\` value like \`"ChildList:trips_list.packing_items.trip_id"\`, parse it as: type=ChildList, view=trips_list, relation=.sourcetable.packing_items$trip_id. When writing back, convert to the new format.

---

### Using get_relation_paths

Call it **once** with all source_table/target_view pairs you need — do not make separate calls per pair. The tool returns paths in the new RelationPath format; always write back in the new format, even if you read legacy strings from an existing config.

When multiple paths are returned for one pair, pick by matching the relation type to what the target view is meant to show:
- **ChildList** — target view shows multiple rows belonging to the current row (e.g. packing items for a trip).
- **ParentShow** — target view shows the single parent the current row belongs to (e.g. the trip for a packing item).
- **OneToOneShow** — exactly one related child row via a unique FK.
- **Own** — target view is on the same table (no FK traversal needed).
- If multiple paths of the same type exist (e.g. a table has two FKs pointing to the same target), pick the one whose FK field name best matches the semantic relationship in the task.
- Prefer shorter paths (fewer segments) unless a longer one is clearly more appropriate.
`;

const typeToLabel = (type) => {
  if (type === RelationType.OWN)
    return "Own – source and target are the same table (no relation needed)";
  if (type === RelationType.INDEPENDENT)
    return "Independent – no FK relationship exists";
  if (type === RelationType.PARENT_SHOW)
    return "ParentShow – outbound FK to a parent record (many-to-one)";
  if (type === RelationType.ONE_TO_ONE_SHOW)
    return "OneToOneShow – unique inbound FK (one-to-one)";
  if (type === RelationType.CHILD_LIST)
    return "ChildList – inbound FK, one parent → many child rows";
  return "RelationPath – complex multi-level path";
};

/**
 * @param {string} sourceTableName
 * @param {string} targetViewName
 * @param {{ tables, views }} schemaData  pre-fetched via build_schema_data()
 * @returns {Array<Relation>}  raw Relation objects from RelationsFinder
 */
function getRelationPaths(sourceTableName, targetViewName, schemaData) {
  if (!schemaData) return [];
  try {
    const finder = new RelationsFinder(schemaData.tables, schemaData.views, 6);
    return finder.findRelations(sourceTableName, targetViewName, []);
  } catch {
    return [];
  }
}

/**
 * Resolve multiple source_table/target_view pairs against pre-fetched schema data.
 * All per-pair work is synchronous — call build_schema_data() once before invoking this.
 * @param {Array<{source_table: string, target_view: string}>} pairs
 * @param {{ tables, views }} schemaData
 * @returns {Array<string>}  one formatted result string per pair
 */
function getRelationPathsForPairs(pairs, schemaData) {
  if (!schemaData) return pairs.map(({ source_table, target_view }) =>
    formatRelationPathResult(source_table, target_view, { error: "Schema data unavailable" })
  );
  const finder = new RelationsFinder(schemaData.tables, schemaData.views, 6);
  return pairs.map(({ source_table, target_view }) => {
    const targetView = (schemaData.views || []).find((v) => v.name === target_view);
    if (!targetView)
      return formatRelationPathResult(source_table, target_view, {
        error: `View "${target_view}" not found in current schema`,
      });
    let relations;
    try {
      relations = finder.findRelations(source_table, target_view, []);
    } catch (e) {
      return formatRelationPathResult(source_table, target_view, {
        error: `Failed to find relations: ${e.message}`,
      });
    }
    return formatRelationPathResult(source_table, target_view, {
      paths: relations.map((r) => ({
        relation_string: r.relationString,
        type: String(r.type),
        label: typeToLabel(r.type),
      })),
    });
  });
}

/**
 * Pick the most useful relation from a list: Own > Parent > Child > first.
 * Used as a fallback in builder-gen when the model doesn't specify a relation.
 */
function pickBestRelation(relations) {
  if (!relations.length) return null;
  let own = null,
    parent = null,
    child = null;
  for (const r of relations) {
    if (r.type === RelationType.OWN) own = r;
    else if (r.type === RelationType.PARENT_SHOW) parent = r;
    else if (
      r.type === RelationType.CHILD_LIST ||
      r.type === RelationType.ONE_TO_ONE_SHOW
    )
      child = r;
  }
  return own || parent || child || relations[0];
}

/**
 * Format the result of getRelationPaths into a human-readable string for the model.
 * Handles both found and not-found cases for one source_table/target_view pair.
 */
function formatRelationPathResult(source_table, target_view, result) {
  if (result.error) return `${source_table} → ${target_view}: ${result.error}`;
  if (!result.paths.length)
    return `${source_table} → ${target_view}: no relation paths found (no FK relationship)`;
  const lines = result.paths
    .map((p) => `    "${p.relation_string}" — ${p.label}`)
    .join("\n");
  return `${source_table} → ${target_view}:\n${lines}`;
}

const GET_RELATION_PATHS_FUNCTION = {
  name: "get_relation_paths",
  description:
    "Get all valid relation path strings for one or more source_table/target_view pairs. " +
    "Call this ONCE with all pairs you need before setting any 'relation' property on " +
    "view_link columns or embedded view (type 'view') segments.",
  parameters: {
    type: "object",
    required: ["pairs"],
    properties: {
      pairs: {
        type: "array",
        description:
          "All source_table/target_view pairs you need relation paths for. Include every pair in one call.",
        items: {
          type: "object",
          required: ["source_table", "target_view"],
          properties: {
            source_table: {
              type: "string",
              description: "The table of the view being built or updated.",
            },
            target_view: {
              type: "string",
              description: "The view to link to or embed.",
            },
          },
        },
      },
    },
  },
};

module.exports = {
  RELATION_PATH_DOC,
  GET_RELATION_PATHS_FUNCTION,
  getRelationPaths,
  getRelationPathsForPairs,
  pickBestRelation,
};
