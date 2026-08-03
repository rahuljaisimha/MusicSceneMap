import { useRef, useEffect } from "react";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";
import type { ForceGraphData } from "../graph/types";

interface Props {
  data: ForceGraphData;
  onNodeClick: (node: { id?: string | number }) => void;
}

export function GraphView({ data, onNodeClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraphMethods | undefined>(undefined);

  useEffect(() => {
    // Fit graph to view when data changes
    if (graphRef.current && data.nodes.length > 0) {
      setTimeout(() => {
        graphRef.current?.zoomToFit(400, 50);
      }, 500);
    }
  }, [data]);

  return (
    <div ref={containerRef} style={{ flex: 1, position: "relative" }}>
      <ForceGraph2D
        ref={graphRef as React.MutableRefObject<ForceGraphMethods | undefined>}
        graphData={data}
        nodeLabel="name"
        nodeColor="color"
        nodeVal="val"
        linkColor="color"
        linkDirectionalArrowLength={3}
        linkDirectionalArrowRelPos={1}
        onNodeClick={onNodeClick}
        backgroundColor="#0f0f0f"
        nodeCanvasObject={(node, ctx, globalScale) => {
          const label = (node as { name?: string }).name ?? "";
          const fontSize = 12 / globalScale;
          const nodeColor = (node as { color?: string }).color ?? "#fff";
          const size = ((node as { val?: number }).val ?? 1) * 2;

          // Draw circle
          ctx.beginPath();
          ctx.arc(node.x ?? 0, node.y ?? 0, size, 0, 2 * Math.PI);
          ctx.fillStyle = nodeColor;
          ctx.fill();

          // Draw label
          if (globalScale > 0.7) {
            ctx.font = `${fontSize}px Sans-Serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillStyle = "#e0e0e0";
            ctx.fillText(label, node.x ?? 0, (node.y ?? 0) + size + fontSize);
          }
        }}
        nodePointerAreaPaint={(node, color, ctx) => {
          const size = ((node as { val?: number }).val ?? 1) * 2;
          ctx.beginPath();
          ctx.arc(node.x ?? 0, node.y ?? 0, size + 4, 0, 2 * Math.PI);
          ctx.fillStyle = color;
          ctx.fill();
        }}
      />
      {data.nodes.length === 0 && (
        <div style={styles.placeholder}>
          Search for an artist to start building the scene graph.
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  placeholder: {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    color: "#666",
    fontSize: "1.1rem",
    textAlign: "center",
  },
};
