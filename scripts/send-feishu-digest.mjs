import "dotenv/config";
import { spawnSync } from "node:child_process";

const apiBaseUrl = process.env.RADAR_API_URL ?? "http://127.0.0.1:8787";
const targetOpenId = process.env.FEISHU_TARGET_OPEN_ID;
if (!targetOpenId) throw new Error("FEISHU_TARGET_OPEN_ID is required");

const response = await fetch(`${apiBaseUrl}/api/analysis`);
if (!response.ok) throw new Error(`Radar analysis API failed: ${response.status}`);
const { data } = await response.json();
const card = buildCard(data);
const cliPath =
  process.env.LARK_CLI_RUNNER ?? `${process.env.APPDATA ?? ""}/npm/node_modules/@larksuite/cli/scripts/run.js`;
const args = [
  "im",
  "+messages-send",
  "--user-id",
  targetOpenId,
  "--msg-type",
  "interactive",
  "--content",
  JSON.stringify(card),
  "--as",
  "bot",
  "--idempotency-key",
  `radar-digest-${Date.now()}`
];
const result = spawnSync(process.execPath, [cliPath, ...args], { stdio: "inherit", shell: false });
process.exit(result.status ?? 1);

function buildCard(analysis) {
  const elements = [
    {
      tag: "markdown",
      content: `**当前机会池** ${analysis.totalOpportunities} · **可行动** ${analysis.actionableCount} · **验证中** ${analysis.validatingCount} · **机会假设** ${analysis.hypothesisCount} · **Demo** ${analysis.demoCount}`
    },
    { tag: "hr" },
    {
      tag: "markdown",
      content: `**当前主要阻塞**\n${analysis.blockers.map((blocker) => `- ${blocker}`).join("\n") || "- 暂无"}`
    }
  ];

  for (const [index, opportunity] of analysis.topOpportunities.slice(0, 3).entries()) {
    elements.push({
      tag: "markdown",
      content: `**${index + 1}. ${opportunity.productName} · ${opportunity.market}**\n${opportunity.analysis.hypothesis}\n\n阶段：${opportunity.evidence.stage} · 数据：${opportunity.evidence.dataQuality} · 决策分：${opportunity.scores.overall} · 证据完整度：${opportunity.evidence.completeness}%\n下一步：${opportunity.analysis.nextBestAction}`
    });
    const links = opportunity.evidenceLinks.slice(0, 3);
    for (const link of links) {
      elements.push({
        tag: "button",
        text: { tag: "plain_text", content: link.label },
        type: "default",
        width: "default",
        behaviors: [
          {
            type: "open_url",
            default_url: link.url,
            pc_url: link.url,
            android_url: link.url,
            ios_url: link.url
          }
        ]
      });
    }
    elements.push({ tag: "hr" });
  }

  return {
    schema: "2.0",
    config: { wide_screen_mode: true },
    header: {
      template: "blue",
      title: { tag: "plain_text", content: "雁巢商品机会雷达 · 商业机会分析摘要" }
    },
    body: { elements }
  };
}
