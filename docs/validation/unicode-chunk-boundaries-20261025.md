# Preserve Unicode at chunk boundaries

Base279f60159cffcd7f9c6256bc0cf877d6a578db65.

## Failure and fix

The last-resort split uses UTF-16 indices. A split through a surrogate pair leaves an isolated high surrogate in one chunk and an isolated low surrogate in the next. Storage replaces these with replacement characters. The overlap tail can start inside a pair too. Adjust only those boundaries by one code unit to keep complete code points.

## Executed evidence

- Prose and code hard-split controls both fail on baseline and pass after the fix, with exact source reassembly when overlap is zero.
- A separate overlap control fails after the hard-split fix and passes after overlap correction.
- Actual ingestText at the default512token boundary writes into isolated PGlite; stored chunks contain replacement characters on baseline, preserve emoji after the fix. No embedding-provider call or mock database.
- Full463tests pass:11generation+210scripts+32app/auth+210RAG. Final focused29pass, typecheck passes. Production build passes; lint0errors11existing warnings.
- Five-trial decoder-independent chunking loop on ordinary52kprose,500iterations: baseline median100.50ms, candidate95.18ms. This is no measured regression, not a general speedup claim.

No dependency, UI, schema or evaluation threshold changes. A code point can exceed the nominal chunk character boundary by one code unit. Grapheme-cluster grouping (e.g. an emoji plus variation selector) is not introduced; this fix prevents invalid UTF-16 and data loss.
