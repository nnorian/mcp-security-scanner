import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { chromium, Browser, Page } from "playwright";

let browser: Browser | null = null;
let page: Page | null = null;

const server = new Server(
  {
    name: "mcp-security-scanner",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "browser_navigate",
      description:
        "Opens the browser and navigates to the specified URL. The browser window will be visible on screen.",
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The URL to navigate to",
          },
        },
        required: ["url"],
      },
    },
    {
      name: "browser_get_content",
      description:
        "Returns the current page's HTML content and basic statistics including form count, input count, and link count",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "browser_find_links",
      description:
        "Collects all links from the current page and lists pages within the same domain",
      inputSchema: {
        type: "object",
        properties: {
          sameDomainOnly: {
            type: "boolean",
            description: "Only list links within the same domain (default: true)",
          },
        },
      },
    },
    {
      name: "browser_close",
      description: "Closes the browser and releases resources",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "browser_navigate": {
      try {
        const url = args?.url as string;

        // Launch browser if not already open
        if (!browser) {
          browser = await chromium.launch({
            headless: false,
            slowMo: 100,
          });
        }

        // Create new page if needed
        if (!page) {
          page = await browser.newPage();
          await page.setViewportSize({ width: 1280, height: 720 });
        }

        // Navigate to URL
        const response = await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });

        const title = await page.title();
        const status = response?.status() || "unknown";

        return {
          content: [
            {
              type: "text",
              text: `Browser opened and navigated to page.\n\nURL: ${url}\nTitle: ${title}\nHTTP Status: ${status}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error}`,
            },
          ],
        };
      }
    }

    case "browser_get_content": {
      try {
        if (!page) {
          return {
            content: [
              {
                type: "text",
                text: "Browser is not open. Use browser_navigate first.",
              },
            ],
          };
        }

        const url = page.url();
        const title = await page.title();

        // Analyze forms in detail
        const formAnalysis = await page.evaluate(() => {
          const forms = document.querySelectorAll("form");
          return Array.from(forms).map((form, index) => {
            const inputs = form.querySelectorAll("input, textarea, select");
            const inputDetails = Array.from(inputs).map((input) => ({
              name: input.getAttribute("name") || "unnamed",
              type: input.getAttribute("type") || input.tagName.toLowerCase(),
              id: input.getAttribute("id") || "no-id",
            }));

            return {
              formIndex: index,
              action: form.getAttribute("action") || "current page",
              method: form.getAttribute("method") || "GET",
              inputCount: inputs.length,
              inputs: inputDetails,
            };
          });
        });

        // Analyze URL parameters
        const urlObj = new URL(url);
        const urlParams = Array.from(urlObj.searchParams.entries());

        // Build report
        let report = `Page Analysis: ${title}\nURL: ${url}\n\n`;

        if (urlParams.length > 0) {
          report += `URL Parameters (${urlParams.length} found):\n`;
          urlParams.forEach(([key, value]) => {
            report += `  - ${key}: ${value}\n`;
          });
          report += `\n`;
        }

        report += `Form Analysis (${formAnalysis.length} forms found):\n\n`;

        formAnalysis.forEach((form) => {
          report += `Form #${form.formIndex + 1}:\n`;
          report += `Action: ${form.action}\n`;
          report += `Method: ${form.method.toUpperCase()}\n`;
          report += `Input Fields (${form.inputCount} fields):\n`;
          form.inputs.forEach((input) => {
            report += `  - ${input.name} (${input.type})\n`;
          });
          report += `\n`;
        });

        if (formAnalysis.length === 0) {
          report += `No forms found on this page.\n`;
        }

        return {
          content: [
            {
              type: "text",
              text: report,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error}`,
            },
          ],
        };
      }
    }

    case "browser_find_links": {
      try {
        if (!page) {
          return {
            content: [
              {
                type: "text",
                text: "Browser is not open. Use browser_navigate first.",
              },
            ],
          };
        }

        const currentUrl = new URL(page.url());
        const sameDomainOnly = args?.sameDomainOnly !== false;

        const links = await page.evaluate(() => {
          const anchors = document.querySelectorAll("a[href]");
          return Array.from(anchors).map((a) => ({
            href: a.getAttribute("href"),
            text: a.textContent?.trim().substring(0, 50) || "no text",
          }));
        });

        // Process and filter links
        const processedLinks = links
          .map((link) => {
            try {
              const url = new URL(link.href!, currentUrl.origin);
              return { url: url.href, text: link.text, domain: url.hostname };
            } catch {
              return null;
            }
          })
          .filter((link) => link !== null)
          .filter((link) => !sameDomainOnly || link!.domain === currentUrl.hostname);

        // Remove duplicates
        const uniqueLinks = [
          ...new Map(processedLinks.map((l) => [l!.url, l])).values(),
        ];

        let report = `Link Analysis\n`;
        report += `Current Page: ${page.url()}\n`;
        report += `Total Links Found: ${links.length}\n`;
        report += `Same Domain Links: ${uniqueLinks.length}\n\n`;
        report += `Discovered Pages:\n`;

        uniqueLinks.slice(0, 30).forEach((link) => {
          report += `  ${link!.text}\n  ${link!.url}\n\n`;
        });

        if (uniqueLinks.length > 30) {
          report += `... and ${uniqueLinks.length - 30} more links\n`;
        }

        return {
          content: [
            {
              type: "text",
              text: report,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error}`,
            },
          ],
        };
      }
    }

    case "browser_close": {
      try {
        if (browser) {
          await browser.close();
          browser = null;
          page = null;
        }

        return {
          content: [
            {
              type: "text",
              text: "Browser closed.",
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error}`,
            },
          ],
        };
      }
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// Cleanup on exit
process.on("SIGINT", async () => {
  if (browser) {
    await browser.close();
  }
  process.exit(0);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Security Scanner started (with Playwright)");
}

main().catch(console.error);
