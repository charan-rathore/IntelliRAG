import snapshot from '../../data/pqueue-demo.json';
import { REPO_DEMO_CORPUS, REPO_DEMO_REVISION, REPO_DEMO_URL } from './repo-demo';
import type { UpsertInput } from './types';

/** A pinned, MIT-licensed public source, recreated on cold start for first-use reliability. */
export const REPO_DEMO_DOCUMENT: UpsertInput = {
  title: 'p-queue README · pinned demo', body: snapshot.body, sourceType: 'github',
  sourceUri: REPO_DEMO_URL, slugHint: 'p-queue-pinned-demo', corpusId: REPO_DEMO_CORPUS,
  originRepo: 'sindresorhus/p-queue', originRef: REPO_DEMO_REVISION, filepath: 'readme.md',
};
