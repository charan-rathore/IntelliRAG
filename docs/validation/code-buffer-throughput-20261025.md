# Code chunk buffer throughput

Based on merged74, main4ab8718. The code-unit splitter joined its growing line buffer once per input line merely to measure its length, and again at symbol boundaries to ask if it had content. A6000-line source file caused repeated large string allocations before chunk creation.

Track exact UTF16bufferlength and a nonwhitespace flag incrementally. Reset both onflush and after recursive tail splitting. Completechunkoutput remainsidentical.

## Executed evidence

- ActualchunkDocument on6000-line code,7trials median20calls: baseline481.58ms -> candidate28.96ms. Local120ms comparativebudgetREDonoldsource/GREENcandidate, notcommittedasflakyCIthreshold.
-108fixture combinations acrosspython/typescript/C/Java,32/128/512chunk sizes,0/8/64overlap: completeoutputs includingallmetadata deep-equal tobaseline. Committedtest fingerprints baselinecapturedbytes, notcandidate-authoredexpectations.
- ActualRAGsuite211existing+goldencontrolPASS (temporarybudgetalsopassedinfullrun). Typecheck/buildPASS,lint0errors11existingwarnings. ExistingpreRAGteststages passed immediatelybeforethisperformancechange; actualcurrentCIrequiredbeforemerge.
- Thisislocalcodechunkerthroughput, not a deployedend-to-endlatencyclaim. Nochange tochunkcontent,corpus,API,dependenciesorUI.

Reviewcheck: botclaimedliteralbackslash-n fixture. ActualcheckedinJavaScriptsource uses'.join(\n)' escape, producingactualnewlines. Addedexplicit183-line andmultiplechunkassertions; baselineandcandidatebothPASSwithsamegoldenfingerprint. Nodifferentfingerprintregeneratedfromcandidate. No publicreplysent.
