# Tenon project instructions

Project-specific guidance for working in this repository. These
supplement the global instructions; where they conflict, the rules
here win.

## Writing (docs, comments, PR text)

These editorial rules apply to all prose: documentation, code comments,
and pull-request descriptions.

- **Capitalisation of the project name.** Write "Tenon" (capitalised)
  when it starts a sentence. Write "tenon" (lowercase) everywhere else:
  in the H1 title, in code and CLI literals (`tenon-generate`,
  `@notahat/tenon`), and mid-sentence, including after a comma (which
  is not a sentence start).

- **No em-dashes.** Avoid em-dashes (—) entirely. They read as a tell
  of AI-assisted writing and put readers off. Recast with a comma,
  period, colon, parentheses, or a joining word like "so" or "where".
  Prefer two short sentences over one spliced with a dash.

- **Don't pre-empt misconceptions the reader doesn't hold.** Don't
  reassure the reader that something isn't happening when they had no
  reason to think it was. Saying "X is not the case" plants the idea
  that X might have been. Show the real behaviour in the examples and
  let it speak. Only call out "tenon does not do X" when readers
  genuinely arrive expecting X (for instance, from a competing tool's
  convention).
