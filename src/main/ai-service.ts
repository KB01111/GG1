import type { AiClassificationInput, AiClassificationResult, Classification, FileSystemItem } from '../shared/types.js';

export interface AiClassifier {
  classify(batch: AiClassificationInput[]): Promise<AiClassificationResult[]>;
}

export class LocalAiClassifier implements AiClassifier {
  async classify(batch: AiClassificationInput[]): Promise<AiClassificationResult[]> {
    return batch.map(({ item, baseline }) => ({
      itemId: item.id,
      kind: baseline.kind,
      riskScore: baseline.riskScore,
      explanation: 'Local AI provider is not configured in this MVP; deterministic metadata rules were used.'
    }));
  }
}

export class CloudAiClassifier implements AiClassifier {
  constructor(private readonly apiKey: string, private readonly baseUrl = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1') {}

  async classify(batch: AiClassificationInput[]): Promise<AiClassificationResult[]> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'Classify storage-cleanup candidates using metadata only. Never recommend direct deletion. Return JSON: {"results":[{"itemId":"","kind":"safe_delete|safe_offload|review_manually|protected_do_not_touch","riskScore":0,"explanation":""}]}.'
          },
          {
            role: 'user',
            content: JSON.stringify(batch.map(({ item, baseline }) => ({
              itemId: item.id,
              path: item.path,
              kind: item.kind,
              size: item.size,
              extension: item.extension,
              modifiedAt: item.modifiedAt,
              accessedAt: item.accessedAt,
              depth: item.depth,
              protected: item.protected,
              baseline
            })))
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`Cloud AI request failed: ${response.status}`);
    }

    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Cloud AI returned an empty response');
    }

    const parsed = JSON.parse(content) as { results?: AiClassificationResult[] };
    return parsed.results ?? [];
  }
}

export class AiService {
  private readonly classifier: AiClassifier;

  constructor() {
    this.classifier = process.env.OPENAI_API_KEY ? new CloudAiClassifier(process.env.OPENAI_API_KEY) : new LocalAiClassifier();
  }

  async classifyWithExplanation(items: FileSystemItem[], baseline: Classification[]): Promise<Classification[]> {
    const baselineById = new Map(baseline.map((classification) => [classification.itemId, classification]));
    const batch = items.map((item) => ({ item, baseline: baselineById.get(item.id) })).filter((entry): entry is AiClassificationInput => Boolean(entry.baseline));
    const aiResults = await this.classifier.classify(batch);
    const aiById = new Map<string, AiClassificationResult>(aiResults.map((result: AiClassificationResult) => [result.itemId, result]));

    return baseline.map((classification) => {
      const ai = aiById.get(classification.itemId);
      if (!ai) {
        return classification;
      }
      if (classification.kind === 'protected_do_not_touch') {
        return { ...classification, aiExplanation: ai.explanation };
      }
      return {
        ...classification,
        kind: ai.kind === 'protected_do_not_touch' ? 'protected_do_not_touch' : classification.kind,
        riskScore: Math.max(classification.riskScore, ai.riskScore),
        aiExplanation: ai.explanation
      };
    });
  }
}
