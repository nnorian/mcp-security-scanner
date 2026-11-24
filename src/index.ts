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
        const html = await page.content();

        // Get basic page statistics
        const forms = await page.locator("form").count();
        const inputs = await page.locator("input").count();
        const links = await page.locator("a").count();

        return {
          content: [
            {
              type: "text",
              text:
                `Page Information:\n\nURL: ${url}\nTitle: ${title}\n\n` +
                `Page Statistics:\n- Forms: ${forms}\n- Inputs: ${inputs}\n- Links: ${links}\n\n` +
                `HTML content (first 2000 characters):\n${html.substring(0, 2000)}...`,
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
