import html from "eslint-plugin-html";

export default [
  {
    files: ["public/index.html", "public/admin.html"],
    plugins: { html },
    languageOptions: {
      globals: {
        window: "readonly",
        document: "readonly",
        localStorage: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        alert: "readonly",
        fetch: "readonly",
        FormData: "readonly",
        URLSearchParams: "readonly",
        Event: "readonly",
        MutationObserver: "readonly",
        IntersectionObserver: "readonly",
        history: "readonly",
        location: "readonly",
        navigator: "readonly",
      },
    },
    rules: {
      "no-unused-vars": "warn",
      "no-undef": "warn",
      "no-console": "off",
      "eqeqeq": "warn",
      "no-var": "warn",
      "prefer-const": "warn",
      "semi": ["warn", "always"],
      "no-unreachable": "error",
      "no-duplicate-case": "error",
      "no-empty": "warn",
    },
  },
];
