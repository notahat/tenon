# tenon documentation

Three sections, depending on what you're trying to do.

- **[Guide](guide/README.md)** — task-oriented walkthroughs.
  Start here if you're new to tenon. Covers installation, schema
  generation, queries, joins, inserts, deletes, and the runtime
  type-mapping caveats.
- **[Reference](reference/README.md)** — symbol-by-symbol API
  reference for every public export. Reach for this when you
  already know what you're looking for.
- **[Architecture](architecture/README.md)** — how tenon is built:
  the AST → fluent → serialiser → executor pipeline, the type
  machinery, and how to add a new operator. For people hacking on
  tenon, not consuming it.

The [`plans/`](plans/) folder holds the iteration history — one
markdown file per increment. Useful for understanding the design
decisions behind each release; not part of the consumer
documentation.
