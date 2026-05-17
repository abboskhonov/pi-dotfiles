import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function formatNum(n: number): string {
	return n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`;
}

function buildStatusLines(ctx: Parameters<Parameters<ExtensionAPI["on"]>[1]>[1]) {
	const usage = ctx.getContextUsage();
	const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow;
	const ctxStr =
		contextWindow && usage && usage.percent !== null
			? `ctx ${Math.round(usage.percent)}%/${(contextWindow / 1000).toFixed(0)}k`
			: "ctx ?";

	let input = 0, output = 0, cost = 0;
	for (const e of ctx.sessionManager.getBranch()) {
		if (e.type === "message" && e.message.role === "assistant") {
			const m = e.message as AssistantMessage;
			input += m.usage?.input ?? 0;
			output += m.usage?.output ?? 0;
			cost += m.usage?.cost?.total ?? 0;
		}
	}

	const theme = ctx.ui.theme;
	const left = theme.fg(
		"muted",
		`${ctxStr} · ↑${formatNum(input)} ↓${formatNum(output)} · $${cost.toFixed(3)}`,
	);
	return [left];
}

export default function (pi: ExtensionAPI) {
	// Re-register the fireworks provider with only the desired model.
	// This replaces ALL built-in and custom fireworks models with just this one.
	pi.registerProvider("fireworks", {
		baseUrl: "https://api.fireworks.ai/inference/v1",
		apiKey: "FIREWORKS_API_KEY",
		api: "openai-completions",
		models: [
			{
				id: "accounts/fireworks/routers/kimi-k2p6-turbo",
				name: "Kimi K2.6 Turbo",
				reasoning: true,
				input: ["text", "image"],
				contextWindow: 262_144,
				maxTokens: 262_144,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			},
		],
	});

	// (stats are shown in the footer by blue-minimal-header.ts; no extra widget)
}
