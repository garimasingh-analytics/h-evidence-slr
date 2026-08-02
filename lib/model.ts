export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ModelOptions {
  temperature?: number;
  maxTokens?: number;
  json?: boolean; // request JSON-mode output
  model?: string; // optional per-task Ollama model override
  groqModel?: string; // optional per-task Groq model override
}

export async function callModel(
  messages: Message[],
  options: ModelOptions = {}
): Promise<string> {
  const provider = process.env.MODEL_PROVIDER ?? 'ollama';

  if (provider === 'groq') {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error('GROQ_API_KEY is not configured. Add a Groq API key in Vercel.');
    }

    const groqModel =
      options.groqModel ?? process.env.GROQ_MODEL ?? 'openai/gpt-oss-120b';
    const groqBody: Record<string, unknown> = {
      model: groqModel,
      messages,
      stream: false,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 2048,
    };
    try {
      const maxAttempts = 4;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 120_000);

        try {
          const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(groqBody),
            signal: controller.signal,
          });

          if (res.ok) {
            const data = (await res.json()) as {
              choices: { message: { content: string } }[];
            };
            return data.choices[0]?.message?.content ?? '';
          }

          const responseText = await res.text();
          if (res.status !== 429 || attempt === maxAttempts) {
            throw new Error(`Groq API error ${res.status}: ${responseText}`);
          }

          const retryAfterHeader = Number.parseFloat(res.headers.get('retry-after') ?? '');
          const retryAfterMessage = responseText.match(/try again in ([\d.]+)s/i);
          const retryAfterSeconds = Number.isFinite(retryAfterHeader)
            ? retryAfterHeader
            : Number.parseFloat(retryAfterMessage?.[1] ?? '10');
          const waitMs = Math.min(30_000, Math.max(1_000, Math.ceil(retryAfterSeconds * 1000) + 500));

          console.warn(`Groq rate limit reached; retrying in ${Math.ceil(waitMs / 1000)}s (attempt ${attempt + 1}/${maxAttempts}).`);
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        } finally {
          clearTimeout(timeout);
        }
      }

      throw new Error('Groq request failed after automatic retries. Please wait one minute and retry.');
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Groq API error 429:')) {
        throw new Error('Groq free-tier rate limit is temporarily busy. Please wait one minute and retry.');
      }
      if (process.env.GROQ_FALLBACK_TO_OLLAMA === 'false') throw err;
      console.warn(
        `Groq request failed; using Ollama fallback: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  if (provider === 'claude') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        'MODEL_PROVIDER is set to "claude" but ANTHROPIC_API_KEY is not set. ' +
          'Set the key or switch MODEL_PROVIDER back to "ollama".'
      );
    }

    const body: Record<string, unknown> = {
      model: 'claude-opus-4-7',
      max_tokens: options.maxTokens ?? 4096,
      messages: messages.filter((m) => m.role !== 'system'),
    };

    const systemMsg = messages.find((m) => m.role === 'system');
    if (systemMsg) {
      body.system = systemMsg.content;
    }
    if (options.temperature !== undefined) {
      body.temperature = options.temperature;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Anthropic API error ${res.status}: ${text}`);
      }

      const data = (await res.json()) as {
        content: { type: string; text: string }[];
      };
      return data.content.find((b) => b.type === 'text')?.text ?? '';
    } finally {
      clearTimeout(timeout);
    }
  }

  // Default: ollama path
  const baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
  const model = options.model ?? process.env.OLLAMA_MODEL ?? 'qwen2.5:14b';

  const body: Record<string, unknown> = {
    model,
    messages,
    stream: false,
  };

  if (options.temperature !== undefined) {
    body.temperature = options.temperature;
  }
  if (options.maxTokens !== undefined) {
    body.max_tokens = options.maxTokens;
  }
  if (options.json) {
    body.format = 'json';
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const secret = process.env.OLLAMA_SECRET;
  if (secret) {
    headers['X-Ollama-Secret'] = secret;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300_000);

  try {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 401) {
        throw new Error('Ollama endpoint rejected the request (401 Unauthorized). Check that OLLAMA_SECRET matches the value in your Caddyfile.');
      }
      throw new Error(`Ollama API error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as {
      choices: { message: { content: string } }[];
    };
    return data.choices[0]?.message?.content ?? '';
  } catch (err) {
    if (err instanceof Error) {
      // Surface connection failures with a clear, actionable message
      const msg = err.message;
      if (
        msg.includes('ECONNREFUSED') ||
        msg.includes('fetch failed') ||
        msg.includes('Failed to fetch') ||
        msg.includes('ENOTFOUND') ||
        msg.includes('aborted') ||
        err.name === 'AbortError'
      ) {
        const isTimeout = msg.includes('aborted') || err.name === 'AbortError';
        throw new Error(
          isTimeout
            ? `Model call timed out after 300s. The model (${model}) may still be loading or the request was too large.`
            : `Cannot reach Ollama at ${baseUrl}. ` +
              'Make sure Ollama is running and OLLAMA_BASE_URL points to it. ' +
              'For the free local setup, run Ollama on this machine and use http://127.0.0.1:11434.'
        );
      }
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
