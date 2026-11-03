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
import { isServerlessRuntime } from "./storage";

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

/**
 * Whether the local pipeline may load at all. The model downloads tens of MB
 * on first use and loads a native ONNX runtime, so on a serverless function
 * (ephemeral disk, cold starts) the default is OFF: an operator opts in with
 * RAG_LOCAL_EMBED=on after checking the runtime fits. On a persistent node
 * process the default is ON, which is the deployment this fallback is for.
 * RAG_LOCAL_EMBED=off disables it anywhere. A failed load is cached for the
 * process, so a missing package or unreachable hub does not retry per query.
 */
export type LocalEmbedSetting = "on" | "off" | "auto";

export function resolveLocalEmbedEnabled(env: {
  RAG_LOCAL_EMBED?: string;
  serverless: boolean;
}): boolean {
  const setting = (env.RAG_LOCAL_EMBED || "auto").toLowerCase();
  if (setting === "on") return true;
  if (setting === "off") return false;
  return !env.serverless;
}

function configured(): boolean {
  return resolveLocalEmbedEnabled({
    RAG_LOCAL_EMBED: process.env.RAG_LOCAL_EMBED,
    serverless: isServerlessRuntime(),
  });
}

function load(): Promise<Extractor | null> {
  if (!configured()) {
    state.failed ??= "Local embeddings disabled (RAG_LOCAL_EMBED=off, or auto on a serverless runtime)";
    return Promise.resolve(null);
  }
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
  // Batch texts of similar length together: every text in a batch is padded
  // to the longest one, so mixed lengths waste most of the compute.
  const order = texts.map((_, i) => i).sort((a, b) => texts[a]!.length - texts[b]!.length);
  const out: Float32Array[] = new Array(texts.length);
  for (let i = 0; i < order.length; i += batchSize) {
    const idx = order.slice(i, i + batchSize);
    const batch = idx.map((k) => (task === "query" ? LOCAL_EMBED_QUERY_PREFIX : "") + texts[k]!);
    const t = await pipe(batch, { pooling: POOLING, normalize: true });
    const dim = t.dims.at(-1)!;
    idx.forEach((k, j) => (out[k] = t.data.slice(j * dim, (j + 1) * dim)));
  }
  return out;
}
