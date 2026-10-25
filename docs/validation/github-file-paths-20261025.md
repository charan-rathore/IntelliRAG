# GitHub file-path import validation

Base: d63d4496c8ad0cbf2363e8b74aefd12ea6170f45.

## Bug and correction

Repository tree entries are decoded file names. Interpolating a `#` into a raw URL creates a fragment; a literal percent escape changes which file is requested. The repository importer catches the fetch failure and counts a skip. Encode URL segments when making raw URLs, and decode blob/tree input URL segments once to avoid double encoding. Plain paths use a fast path; malformed percent sequences do not throw.

No dependencies, UI, schema, credential policy or provider behavior changed.

## Executed RED/GREEN

- Actual ingestFromUrl traverses a controlled GitHub tree response, fetches a file containing hash/percent/space characters, imports it through ingestText, writes isolated PGlite and verifies the stored body. Baseline6pass1fail; candidate passes. This is real ingestion/storage with controlled network responses, not a claim of a deployed GitHub import.
- An already escaped blob URL was a separate failing control before parse correction. It now round-trips the decoded path to the correct raw URL exactly once.
- Additional URL helper control covers non-ASCII paths, literal %20 and a branch containing slash.
- Full regression:459pass (11 generation,210 script,32 app/auth,206 RAG); type/build pass; lint0errors11existing warnings. Final no-percent fast path rerun:206RAGpass, type/buildpass.

## Limits

GitHub's ambiguous slash-containing branch names are not newly resolved here. Browser UI was unchanged; these are server-side ingestion tests. Real remote requests and production deployment were not exercised by this proof.
