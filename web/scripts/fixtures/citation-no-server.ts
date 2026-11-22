// This navigation-only fixture never exercises server functions. Throw rather
// than silently succeeding if an unrelated action is accidentally triggered.
const forbidden = () => {
  throw new Error("Server functions are outside the citation-navigation fixture");
};
export const embedNextBatch = forbidden;
export const getCorpusSuggestions = forbidden;
export const getLabSnapshot = forbidden;
export const ingestPastedDocument = forbidden;
export const ingestRemoteUrl = forbidden;
export const removeDocument = forbidden;
export const submitGraphFeedback = forbidden;
export const submitSourcePick = forbidden;
export const getCorpusMemory = forbidden;
export const runSleep = forbidden;
export const searchSources = forbidden;
export const suggestSearch = forbidden;
export const getSourceDocument = forbidden;
export const saveLabKeys = forbidden;
