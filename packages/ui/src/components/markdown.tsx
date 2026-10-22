import { memo, useMemo, type ReactNode } from "react";
import { cn } from "@pego/ui/lib/utils";
import { parseMarkdown, type Block, type Inline, type TableAlign } from "@pego/ui/lib/markdown";

const ALIGN_CLASS: Record<Exclude<TableAlign, null>, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

const HEADING_CLASS = {
  1: "text-base font-semibold leading-snug",
  2: "text-[15px] font-semibold leading-snug",
  3: "text-sm font-semibold leading-snug",
} as const;

const renderInlines = (nodes: readonly Inline[]): ReactNode =>
  nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return node.text;
      case "br":
        return <br key={index} />;
      case "strong":
        return (
          <strong key={index} className="font-semibold">
            {renderInlines(node.children)}
          </strong>
        );
      case "em":
        return <em key={index}>{renderInlines(node.children)}</em>;
      case "del":
        return (
          <del key={index} className="text-muted-foreground">
            {renderInlines(node.children)}
          </del>
        );
      case "code":
        return (
          <code
            key={index}
            className="rounded-sm bg-muted px-1 py-px font-mono text-[0.85em] break-words"
          >
            {node.text}
          </code>
        );
      case "link":
        return (
          <a
            key={index}
            href={node.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-violet underline-offset-2 hover:underline focus-visible:underline"
          >
            {renderInlines(node.children)}
          </a>
        );
    }
  });

const renderBlocks = (blocks: readonly Block[]): ReactNode =>
  blocks.map((block, index) => <BlockView key={index} block={block} />);

const BlockView = ({ block }: { block: Block }) => {
  switch (block.type) {
    case "paragraph":
      return <p className="text-pretty">{renderInlines(block.children)}</p>;
    case "heading":
      return (
        <div
          role="heading"
          aria-level={block.level + 2}
          className={cn("mt-1 text-balance", HEADING_CLASS[block.level])}
        >
          {renderInlines(block.children)}
        </div>
      );
    case "code":
      return (
        <div className="overflow-hidden rounded-md border bg-muted">
          {block.lang ? (
            <div className="border-b px-2 py-0.5 font-mono text-[10px] leading-4 text-muted-foreground">
              {block.lang}
            </div>
          ) : null}
          <pre
            tabIndex={0}
            className="overflow-x-auto px-2 py-1.5 font-mono text-xs leading-4 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
          >
            <code>{block.text}</code>
          </pre>
        </div>
      );
    case "list": {
      const className = cn(
        "marker:text-muted-foreground",
        block.ordered ? "list-decimal pl-5 marker:tabular-nums" : "list-disc pl-4",
      );
      const items = block.items.map((item, index) => (
        <li key={index} className="pl-0.5 [&>*+*]:mt-1">
          {renderBlocks(item)}
        </li>
      ));
      return block.ordered ? (
        <ol start={block.start} className={className}>
          {items}
        </ol>
      ) : (
        <ul className={className}>{items}</ul>
      );
    }
    case "quote":
      return (
        <blockquote className="space-y-1.5 border-l-2 pl-2 text-muted-foreground">
          {renderBlocks(block.children)}
        </blockquote>
      );
    case "hr":
      return <hr className="my-1 border-border" />;
    case "table":
      return (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full border-collapse text-xs leading-4">
            <thead className="bg-muted">
              <tr>
                {block.head.map((cell, col) => (
                  <th
                    key={col}
                    scope="col"
                    className={cn(
                      "px-2 py-1 font-semibold",
                      ALIGN_CLASS[block.align[col] ?? "left"],
                    )}
                  >
                    {renderInlines(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            {block.rows.length > 0 ? (
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={r} className="border-t">
                    {row.map((cell, col) => (
                      <td
                        key={col}
                        className={cn(
                          "px-2 py-1 align-top",
                          ALIGN_CLASS[block.align[col] ?? "left"],
                        )}
                      >
                        {renderInlines(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ) : null}
          </table>
        </div>
      );
  }
};

/**
 * Renders a Markdown string (CommonMark/GFM subset) as React elements. Never injects HTML: raw
 * HTML in `text` shows as literal text and only http/https/mailto links are made clickable.
 * Safe to re-render on every streamed chunk with partial syntax.
 */
export const Markdown = memo(({ text, className }: { text: string; className?: string }) => {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <div
      data-selectable
      className={cn("min-w-0 space-y-1.5 text-sm leading-5 break-words", className)}
    >
      {renderBlocks(blocks)}
    </div>
  );
});
Markdown.displayName = "Markdown";
