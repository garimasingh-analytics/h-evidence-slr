export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ModelOptions {
  temperature?: number;
  maxTokens?: number;
  json?: boolean; // request JSON-mode output
}

export async function callModel(
  messages: Message[],
  options: ModelOptions = {}
): Promise<string> {
  const provider = process.env.MODEL_PROVIDER ?? 'ollama';

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
  const model = process.env.OLLAMA_MODEL ?? 'qwen2.5:14b';

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
      throw new Error(`Ollama API error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as {
      choices: { message: { content: string } }[];
    };
    return data.choices[0]?.message?.content ?? '';
  } finally {
    clearTimeout(timeout);
  }
}
