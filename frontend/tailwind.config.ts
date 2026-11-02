import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // 基础语义 token —— 深色青绿终端风（Terminal / Hacker）
        ink: "#c9f7e8", // 主文字：浅青绿
        muted: "#7fa89a", // 次级文字：青灰
        faint: "#5e8376", // 三级文字：深青灰
        paper: "#0a0e0d", // 页面背景：深墨绿黑
        panel: "#0d1612", // 内容表面
        "panel-2": "#101a15", // 次级表面
        "panel-3": "#16271f", // hover / 浮层
        line: "#1c2b25", // 分隔线：深绿灰
        "line-strong": "#2a3f37", // 稍强边框
        accent: "#2dd4a7", // 荧光青绿主色
        "accent-deep": "#0d9488", // 深青绿（hover / active）
        "accent-bright": "#5eead4", // 更亮青绿
        "accent-ink": "#062a1d", // 荧光青底上的深字
        warn: "#f59e0b", // 待处理：琥珀

        // 荧光青绿色阶（小=浅，大=深）
        sage: {
          50: "#ecfdf5",
          100: "#d1fae5",
          200: "#a7f3d0",
          300: "#6ee7b7",
          400: "#34d399",
          500: "#2dd4a7",
          600: "#0d9488",
          700: "#0f766e",
          800: "#115e59",
          900: "#134e4a",
        },

        // 深色中性灰（小=浅，大=深）
        stone: {
          50: "#eafff6",
          100: "#d3f8e9",
          200: "#a8d9cb",
          300: "#7fa89a",
          400: "#5e8376",
          500: "#4a665c",
          600: "#345044",
          700: "#27403a",
          800: "#1b2e29",
          900: "#101c17",
          950: "#060a08",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          "Roboto",
          '"Helvetica Neue"',
          "Arial",
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          '"SF Mono"',
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          '"Liberation Mono"',
          "monospace",
        ],
      },
      boxShadow: {
        // 克制的阴影：仅用于浮层 / 弹窗
        panel: "0 1px 2px rgba(0, 0, 0, 0.4), 0 4px 16px rgba(0, 0, 0, 0.35)",
        popover: "0 2px 8px rgba(0, 0, 0, 0.5), 0 12px 32px rgba(0, 0, 0, 0.45)",
        glow: "0 0 0 1px rgba(45, 212, 167, 0.35)",
      },
      borderRadius: {
        // 更锐利的圆角，强化终端感
        sm: "2px",
        md: "4px",
        lg: "6px",
      },
    },
  },
  plugins: [],
};

export default config;
