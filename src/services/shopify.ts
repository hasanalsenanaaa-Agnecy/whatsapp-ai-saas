// ============================================================
// SHOPIFY STOREFRONT API SERVICE
// Integrates with Shopify GraphQL Storefront API
// ============================================================

export interface ShopifyProduct {
  id: string;
  title: string;
  description: string;
  priceMin: string;
  priceMax: string;
  imageUrl: string | null;
  variants: ShopifyVariant[];
}

export interface ShopifyVariant {
  id: string;
  title: string;
  price: string;
  available: boolean;
}

export interface ShopifyCheckout {
  checkoutUrl: string;
  totalPrice: string;
  currency: string;
}

// ============================================================
// GRAPHQL QUERIES
// ============================================================

const PRODUCTS_QUERY = `
  query getProducts($first: Int!) {
    products(first: $first) {
      edges {
        node {
          id
          title
          description
          priceRange {
            minVariantPrice { amount currencyCode }
            maxVariantPrice { amount currencyCode }
          }
          images(first: 1) {
            edges { node { url } }
          }
          variants(first: 10) {
            edges {
              node {
                id
                title
                price { amount currencyCode }
                availableForSale
              }
            }
          }
        }
      }
    }
  }
`;

const SEARCH_PRODUCTS_QUERY = `
  query searchProducts($query: String!, $first: Int!) {
    products(first: $first, query: $query) {
      edges {
        node {
          id
          title
          description
          priceRange {
            minVariantPrice { amount currencyCode }
            maxVariantPrice { amount currencyCode }
          }
          images(first: 1) {
            edges { node { url } }
          }
          variants(first: 10) {
            edges {
              node {
                id
                title
                price { amount currencyCode }
                availableForSale
              }
            }
          }
        }
      }
    }
  }
`;

const PRODUCT_BY_ID_QUERY = `
  query getProduct($id: ID!) {
    product(id: $id) {
      id
      title
      description
      priceRange {
        minVariantPrice { amount currencyCode }
        maxVariantPrice { amount currencyCode }
      }
      images(first: 1) {
        edges { node { url } }
      }
      variants(first: 10) {
        edges {
          node {
            id
            title
            price { amount currencyCode }
            availableForSale
          }
        }
      }
    }
  }
`;

const CREATE_CART_MUTATION = `
  mutation createCart($variantId: ID!, $quantity: Int!) {
    cartCreate(input: {
      lines: [{ merchandiseId: $variantId, quantity: $quantity }]
    }) {
      cart {
        id
        checkoutUrl
        totalQuantity
        cost {
          totalAmount { amount currencyCode }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const CREATE_MULTI_CART_MUTATION = `
  mutation createMultiCart($lines: [CartLineInput!]!) {
    cartCreate(input: {
      lines: $lines
    }) {
      cart {
        id
        checkoutUrl
        totalQuantity
        cost {
          totalAmount { amount currencyCode }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// ============================================================
// HELPER FUNCTIONS
// ============================================================

async function shopifyGraphQL(
  shopifyDomain: string,
  storefrontToken: string | undefined,
  query: string,
  variables: Record<string, unknown>
): Promise<unknown> {
  const url = `https://${shopifyDomain}/api/2026-04/graphql.json`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };

  // Token-based auth if token provided; otherwise use tokenless access
  if (storefrontToken) {
    headers['X-Shopify-Storefront-Access-Token'] = storefrontToken;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables })
  });

  if (!response.ok) {
    throw new Error(`Shopify API error: ${response.status} ${response.statusText}`);
  }

  const json = await response.json() as { data?: unknown; errors?: { message: string }[] };

  if (json.errors?.length) {
    throw new Error(`Shopify GraphQL error: ${json.errors[0]?.message}`);
  }

  return json.data;
}

function parseProduct(node: Record<string, unknown>): ShopifyProduct {
  const priceRange = node.priceRange as {
    minVariantPrice: { amount: string; currencyCode: string };
    maxVariantPrice: { amount: string; currencyCode: string };
  };
  const images = node.images as { edges: { node: { url: string } }[] };
  const variants = node.variants as { edges: { node: { id: string; title: string; price: { amount: string }; availableForSale: boolean } }[] };

  const priceMin = parseFloat(priceRange.minVariantPrice.amount).toFixed(2);
  const priceMax = parseFloat(priceRange.maxVariantPrice.amount).toFixed(2);

  return {
    id: node.id as string,
    title: node.title as string,
    description: (node.description as string) || '',
    priceMin,
    priceMax,
    imageUrl: images.edges[0]?.node.url ?? null,
    variants: variants.edges.map(e => ({
      id: e.node.id,
      title: e.node.title,
      price: parseFloat(e.node.price.amount).toFixed(2),
      available: e.node.availableForSale
    }))
  };
}

/** Format a price amount as a locale-formatted number */
export function formatPrice(amount: string | number, currency?: string): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return '0';
  const formatted = num.toLocaleString('ar-SA', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  if (!currency) return formatted;
  const symbols: Record<string, string> = { KWD: 'د.ك', SAR: 'ريال', AED: 'د.إ', USD: '$' };
  return `${formatted} ${symbols[currency] ?? currency}`;
}

/** @deprecated Use formatPrice instead */
export function formatPriceSAR(amount: string | number): string {
  return formatPrice(amount);
}

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Fetch products from Shopify store (up to 20 by default)
 */
export async function fetchProducts(
  shopifyDomain: string,
  storefrontToken?: string,
  limit = 20
): Promise<ShopifyProduct[]> {
  try {
    const data = await shopifyGraphQL(shopifyDomain, storefrontToken, PRODUCTS_QUERY, { first: limit }) as {
      products: { edges: { node: Record<string, unknown> }[] };
    };
    return data.products.edges.map(e => parseProduct(e.node));
  } catch (error) {
    console.error('❌ Shopify fetchProducts error:', error);
    return [];
  }
}

/**
 * Search products by keyword
 */
export async function searchProducts(
  shopifyDomain: string,
  storefrontToken: string | undefined,
  query: string,
  limit = 10
): Promise<ShopifyProduct[]> {
  try {
    const data = await shopifyGraphQL(shopifyDomain, storefrontToken, SEARCH_PRODUCTS_QUERY, { query, first: limit }) as {
      products: { edges: { node: Record<string, unknown> }[] };
    };
    return data.products.edges.map(e => parseProduct(e.node));
  } catch (error) {
    console.error('❌ Shopify searchProducts error:', error);
    return [];
  }
}

/**
 * Get a single product by its Shopify GID
 */
export async function getProductById(
  shopifyDomain: string,
  storefrontToken: string | undefined,
  productId: string
): Promise<ShopifyProduct | null> {
  try {
    const data = await shopifyGraphQL(shopifyDomain, storefrontToken, PRODUCT_BY_ID_QUERY, { id: productId }) as {
      product: Record<string, unknown> | null;
    };
    if (!data.product) return null;
    return parseProduct(data.product);
  } catch (error) {
    console.error('❌ Shopify getProductById error:', error);
    return null;
  }
}

/**
 * Create a Shopify cart and return a checkout URL (modern Cart API)
 */
export async function createCheckout(
  shopifyDomain: string,
  storefrontToken: string | undefined,
  variantId: string,
  quantity = 1
): Promise<ShopifyCheckout | null> {
  try {
    const data = await shopifyGraphQL(shopifyDomain, storefrontToken, CREATE_CART_MUTATION, { variantId, quantity }) as {
      cartCreate: {
        cart: { id: string; checkoutUrl: string; cost: { totalAmount: { amount: string; currencyCode: string } } } | null;
        userErrors: { field: string; message: string }[];
      };
    };

    const result = data.cartCreate;

    if (result.userErrors.length > 0) {
      console.error('❌ Shopify cart errors:', result.userErrors);
      return null;
    }

    if (!result.cart) return null;

    return {
      checkoutUrl: result.cart.checkoutUrl,
      totalPrice: parseFloat(result.cart.cost.totalAmount.amount).toFixed(2),
      currency: result.cart.cost.totalAmount.currencyCode
    };
  } catch (error) {
    console.error('❌ Shopify createCheckout error:', error);
    return null;
  }
}

/**
 * Create a multi-item Shopify cart and return a checkout URL
 */
export async function createMultiItemCheckout(
  shopifyDomain: string,
  storefrontToken: string | undefined,
  items: { variantId: string; quantity: number }[]
): Promise<ShopifyCheckout | null> {
  try {
    const lines = items.map(item => ({
      merchandiseId: item.variantId,
      quantity: item.quantity
    }));

    const data = await shopifyGraphQL(shopifyDomain, storefrontToken, CREATE_MULTI_CART_MUTATION, { lines }) as {
      cartCreate: {
        cart: { id: string; checkoutUrl: string; cost: { totalAmount: { amount: string; currencyCode: string } } } | null;
        userErrors: { field: string; message: string }[];
      };
    };

    const result = data.cartCreate;
    if (result.userErrors.length > 0) {
      console.error('❌ Shopify multi-cart errors:', result.userErrors);
      return null;
    }
    if (!result.cart) return null;

    return {
      checkoutUrl: result.cart.checkoutUrl,
      totalPrice: parseFloat(result.cart.cost.totalAmount.amount).toFixed(2),
      currency: result.cart.cost.totalAmount.currencyCode
    };
  } catch (error) {
    console.error('❌ Shopify createMultiItemCheckout error:', error);
    return null;
  }
}
