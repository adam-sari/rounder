import type { Lang } from './options';

export const samples: Record<Lang, string> = {
  css: `/*! Workshop theme v1.2 | MIT */

/* Base styles */
:root {
  --ink: #f2ede4;
  --sun: #ffd25e;
}

body {
  margin: 0px;
  padding: 0px;
  color: var(--ink);
  font-family: "Geist", system-ui, sans-serif;
}

.button {
  padding: 12px 18px 12px 18px;
  border-radius: 12px;
  background-color: #ffffff;
}

.button:hover {
  background-color: #ffffff;
  border-color: #ffd25e;
}

.card {
  border-radius: 12px;
  padding: 24px;
}
`,
  js: `/*! tiny-cart v0.3 | MIT */

// Keeps a running total of the items in a cart
export function createCart(taxRate = 0.2) {
  const items = [];

  function add(name, price, quantity = 1) {
    const existing = items.find((item) => item.name === name);
    if (existing) {
      existing.quantity += quantity;
    } else {
      items.push({ name: name, price: price, quantity: quantity });
    }
  }

  function total() {
    const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    return Math.round(subtotal * (1 + taxRate) * 100) / 100;
  }

  return { add: add, total: total };
}
`,
  html: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>  My little page  </title>
    <!-- styles for the header -->
    <style>
      header { padding: 24px 24px 24px 24px; }
      h1 { color: #ff0000; }
    </style>
  </head>
  <body>
    <header class="  site-header   dark ">
      <h1>Hello, <em>world</em>!</h1>
    </header>
    <pre>
  Spacing in here
      stays exactly as it is.
    </pre>
    <p style="margin: 0px 0px 8px 0px;">
      Made with   care.
    </p>
    <script>
      // say hi
      function greet(name) {
        console.log("Hello, " + name + "!");
      }
      greet("visitor");
    </script>
  </body>
</html>
`,
};
