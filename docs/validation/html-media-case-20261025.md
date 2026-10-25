# Case-insensitive HTML media types

Based on main9e980cd. A fragment served as Text/HTML; Charset=UTF-8 bypassed HTML cleanup because the header comparison was case-sensitive and the fallback sniff recognizes only full HTML/doctype documents. Script/style content and markup entered the searchable corpus.

Normalize just the response media-type token before existing cleanup. No change to entity decoding or the held HTML-reference candidate. Plaintext has the same existing fallback rules.

ActualingestFromUrl->isolatedPGlite storage proof with a controlled fetch boundary: baseline7PASS1FAIL, candidate8PASS. Stored body contains human text and neither script payload nor section markup. This is actual ingest/storage execution, not remote-server or deployment proof.

All211RAGtestsPASS; existing npm test pre-RAG stages pass. The npm-script npx wrapper could not unpack due to systempermission, so reran RAG explicitly using alreadyinstalledtsxCLI without modifying dependencies. Typecheck/buildpass, lint0errors11existingwarnings. No test claimed before it actually ran.
