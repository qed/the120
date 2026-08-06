import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The SDK wrappers, actually executed.
 *
 * WHY THIS FILE EXISTS SEPARATELY: `realGenerateImage` / `realGenerateText` are
 * the ONLY place `maxRetries: 0` and the abort signal reach the vendor SDK, and
 * no test in the main suite runs them — every other test injects a fake in their
 * place. Deleting `maxRetries: options.maxRetries` would therefore restore the
 * SDK's default of 2 internal retries — turning one staff click into THREE paid
 * image generations — with a completely green suite.
 *
 * Proving that needs `vi.mock("ai")`, which is hoisted and file-wide, so it lives
 * here rather than poisoning the injected-fake tests next door.
 */

const generateImageMock = vi.hoisted(() => vi.fn());
const generateTextMock = vi.hoisted(() => vi.fn());

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateImage: generateImageMock,
  generateText: generateTextMock,
}));

const { realGenerateImage, realGenerateText } = await import("../image-model");

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const file = { uint8Array: PNG, mediaType: "image/png" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("realGenerateImage: what the SDK actually receives", () => {
  beforeEach(() => {
    generateImageMock.mockResolvedValue({ images: [file], providerMetadata: { gateway: {} } });
  });

  it("forwards maxRetries VERBATIM — the retry policy is ours, not the SDK's", async () => {
    const abortSignal = AbortSignal.timeout(1000);
    await realGenerateImage({
      model: "openai/gpt-image-2",
      prompt: "a poster",
      n: 1,
      maxRetries: 0,
      abortSignal,
    });
    const call = generateImageMock.mock.calls[0]![0];
    // The whole point: 0, passed through, on the real SDK call.
    expect(call.maxRetries).toBe(0);
    expect(call.abortSignal).toBe(abortSignal);
    expect(call.model).toBe("openai/gpt-image-2");
    expect(call.prompt).toBe("a poster");
    expect(call.n).toBe(1);
  });

  it("forwards providerOptions when present and OMITS the key entirely when not", async () => {
    await realGenerateImage({
      model: "openai/gpt-image-2",
      prompt: "a poster",
      n: 1,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(1000),
      providerOptions: { openai: { quality: "high" } },
    });
    expect(generateImageMock.mock.calls[0]![0].providerOptions).toEqual({
      openai: { quality: "high" },
    });

    await realGenerateImage({
      model: "openai/gpt-image-2",
      prompt: "a poster",
      n: 1,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(1000),
    });
    // An explicit `providerOptions: undefined` is a different request body from
    // an absent key on some providers, so the wrapper spreads rather than sets.
    expect("providerOptions" in generateImageMock.mock.calls[1]![0]).toBe(false);
  });

  it("carries the edit-style prompt object through unchanged", async () => {
    const prompt = { images: [PNG], text: "a poster" };
    await realGenerateImage({
      model: "openai/gpt-image-2",
      prompt,
      n: 1,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(1000),
    });
    expect(generateImageMock.mock.calls[0]![0].prompt).toBe(prompt);
  });

  it("maps the SDK result down to the two fields the adapter reads", async () => {
    const result = await realGenerateImage({
      model: "openai/gpt-image-2",
      prompt: "a poster",
      n: 1,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(1000),
    });
    expect(result.images).toEqual([file]);
    expect(result.providerMetadata).toEqual({ gateway: {} });
  });
});

describe("realGenerateText: what the SDK actually receives", () => {
  beforeEach(() => {
    generateTextMock.mockResolvedValue({
      files: [file],
      finishReason: "stop",
      rawFinishReason: "STOP",
      providerMetadata: { gateway: { generationId: "gen_1" } },
    });
  });

  it("forwards maxRetries, the signal and the message content verbatim", async () => {
    const abortSignal = AbortSignal.timeout(1000);
    const messages = [
      {
        role: "user" as const,
        content: [{ type: "text" as const, text: "a poster" }],
      },
    ];
    await realGenerateText({
      model: "google/gemini-3-pro-image",
      messages,
      maxRetries: 0,
      abortSignal,
      providerOptions: { google: { responseModalities: ["TEXT", "IMAGE"] } },
    });
    const call = generateTextMock.mock.calls[0]![0];
    expect(call.maxRetries).toBe(0);
    expect(call.abortSignal).toBe(abortSignal);
    expect(call.model).toBe("google/gemini-3-pro-image");
    expect(call.messages).toBe(messages);
    expect(call.providerOptions).toEqual({ google: { responseModalities: ["TEXT", "IMAGE"] } });
  });

  it("maps files, BOTH finish reasons, and provider metadata", async () => {
    // `rawFinishReason` is load-bearing: it is the vendor's own safety token, and
    // dropping it here would make every PROHIBITED_CONTENT block classify as an
    // ordinary zero-files provider error.
    const result = await realGenerateText({
      model: "google/gemini-3-pro-image",
      messages: [{ role: "user", content: [{ type: "text", text: "a poster" }] }],
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(1000),
    });
    expect(result.files).toEqual([file]);
    expect(result.finishReason).toBe("stop");
    expect(result.rawFinishReason).toBe("STOP");
    expect(result.providerMetadata).toEqual({ gateway: { generationId: "gen_1" } });
  });

  it("omits providerOptions entirely when the entry has none", async () => {
    await realGenerateText({
      model: "google/gemini-3-pro-image",
      messages: [{ role: "user", content: [{ type: "text", text: "a poster" }] }],
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(1000),
    });
    expect("providerOptions" in generateTextMock.mock.calls[0]![0]).toBe(false);
  });
});
