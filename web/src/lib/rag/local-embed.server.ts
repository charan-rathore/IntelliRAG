/**
 * Local sentence embeddings: no API key, no network after the first model
 * download, no per-query cost.
 *
 * Default model: BAAI bge-small-en-v1.5 (33M parameters, 384 dimensions) as
 * int8 ONNX through @huggingface/transformers. CLS pooling and the query
 * instruction follow the model card. The package is loaded lazily and is
 * optional: when it is not installed, `localEmbeddingsAvailable()` resolves
 * false and callers keep BM25.
 */
export const LOCAL_EMBED_MODEL = process.env.RAG_LOCAL_EMBED_MODEL || "Xenova/bge-small-en-v1.5";
export const LOCAL_EMBED_QUERY_PREFIX =
  process.env.RAG_LOCAL_EMBED_QUERY_PREFIX ??
  "Represent this sentence for searching relevant passages: ";
const POOLING = (process.env.RAG_LOCAL_EMBED_POOLING || "cls") as "cls" | "mean";
const DTYPE = process.env.RAG_LOCAL_EMBED_DTYPE || "q8";

type Extractor = (
  texts: string[],
  opts: { pooling: "cls" | "mean"; normalize: boolean },
) => Promise<{ data: Float32Array; dims: number[] }>;

const state: {
  pipe: Extractor | null;
  loading: Promise<Extractor | null> | null;
  failed: string | null;
} = {
  pipe: null,
  loading: null,
  failed: null,
};

function load(): Promise<Extractor | null> {
  state.loading ??= (async () => {
    try {
      // A variable specifier keeps bundlers and the type checker from
      // requiring the optional package.
      const name = "@huggingface/transformers";
      const mod = (await import(/* @vite-ignore */ name)) as {
        pipeline: (
          task: string,
          model: string,
          opts: Record<string, unknown>,
        ) => Promise<Extractor>;
        env: { cacheDir: string };
      };
      if (process.env.RAG_MODEL_CACHE) mod.env.cacheDir = process.env.RAG_MODEL_CACHE;
      state.pipe = await mod.pipeline("feature-extraction", LOCAL_EMBED_MODEL, { dtype: DTYPE });
      return state.pipe;
    } catch (error) {
      state.failed = error instanceof Error ? error.message : String(error);
      return null;
    }
  })();
  return state.loading;
}

export async function localEmbeddingsAvailable(): Promise<boolean> {
  return Boolean(await load());
}

export function localEmbedStatus() {
  return {
    model: LOCAL_EMBED_MODEL,
    pooling: POOLING,
    dtype: DTYPE,
    resident: Boolean(state.pipe),
    failed: state.failed,
  };
}

/** L2-normalised embeddings, one per text, in input order. */
export async function localEmbed(
  texts: string[],
  task: "query" | "document",
  batchSize = 32,
): Promise<Float32Array[]> {
  const pipe = await load();
  if (!pipe) throw new Error(`Local embeddings unavailable: ${state.failed ?? "not loaded"}`);
  const out: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts
      .slice(i, i + batchSize)
      .map((t) => (task === "query" ? LOCAL_EMBED_QUERY_PREFIX + t : t));
    const t = await pipe(batch, { pooling: POOLING, normalize: true });
    const dim = t.dims.at(-1)!;
    for (let j = 0; j < batch.length; j += 1) out.push(t.data.slice(j * dim, (j + 1) * dim));
  }
  return out;
}
