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
  compareAtPriceMin: string | null; // original price before discount, null if no sale
  imageUrl: string | null;
  tags: string[];                   // merchant-set tags: 'best-seller', 'gift', 'new', etc.
  variants: ShopifyVariant[];
}

export interface ShopifyVariant {
  id: string;
  title: string;
  price: string;
  compareAtPrice: string | null;    // original price for this variant if on sale
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

// sortKey defaults to BEST_SELLING so the order reflects real Shopify sales data
// @inContext(language: $language) tells Shopify to return translated
// titles/descriptions from the Translate & Adapt app. Without it,
// Accept-Language alone is unreliable — you get the default shop
// language even for products that DO have Arabic translations.
const PRODUCTS_QUERY = `
  query getProducts($first: Int!, $sortKey: ProductSortKeys, $reverse: Boolean, $language: LanguageCode!) @inContext(language: $language) {
    products(first: $first, sortKey: $sortKey, reverse: $reverse) {
      edges {
        node {
          id
          title
          description
          tags
          priceRange {
            minVariantPrice { amount currencyCode }
            maxVariantPrice { amount currencyCode }
          }
          compareAtPriceRange {
            minVariantPrice { amount currencyCode }
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
                compareAtPrice { amount currencyCode }
                availableForSale
              }
            }
          }
        }
      }
    }
  }
`;

function buildCartMutation(countryCode?: string): string {
  const ctx = countryCode ? ` @inContext(country: ${countryCode})` : '';
  const identity = countryCode ? `buyerIdentity: { countryCode: ${countryCode} },` : '';
  return `
  mutation createCart($variantId: ID!, $quantity: Int!)${ctx} {
    cartCreate(input: {
      ${identity}
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
}

function buildMultiCartMutation(countryCode?: string): string {
  const ctx = countryCode ? ` @inContext(country: ${countryCode})` : '';
  const identity = countryCode ? `buyerIdentity: { countryCode: ${countryCode} },` : '';
  return `
  mutation createMultiCart($lines: [CartLineInput!]!)${ctx} {
    cartCreate(input: {
      ${identity}
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
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

async function shopifyGraphQL(
  shopifyDomain: string,
  storefrontToken: string | undefined,
  query: string,
  variables: Record<string, unknown>,
  lang = 'ar'
): Promise<unknown> {
  const url = `https://${shopifyDomain}/api/2026-04/graphql.json`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept-Language': lang === 'en' ? 'en' : 'ar'
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
  const compareAtPriceRange = node.compareAtPriceRange as {
    minVariantPrice: { amount: string; currencyCode: string } | null;
  } | null;
  const images = node.images as { edges: { node: { url: string } }[] };
  const variants = node.variants as { edges: { node: { id: string; title: string; price: { amount: string }; compareAtPrice: { amount: string } | null; availableForSale: boolean } }[] };
  const tags = (node.tags as string[]) || [];

  const priceMin = parseFloat(priceRange.minVariantPrice.amount).toFixed(2);
  const priceMax = parseFloat(priceRange.maxVariantPrice.amount).toFixed(2);
  const compareAtRaw = compareAtPriceRange?.minVariantPrice?.amount;
  const compareAtPriceMin = compareAtRaw && parseFloat(compareAtRaw) > parseFloat(priceMin)
    ? parseFloat(compareAtRaw).toFixed(2)
    : null;

  return {
    id: node.id as string,
    title: node.title as string,
    description: (node.description as string) || '',
    priceMin,
    priceMax,
    compareAtPriceMin,
    imageUrl: images.edges[0]?.node.url ?? null,
    tags,
    variants: variants.edges.map(e => {
      const compareAt = e.node.compareAtPrice?.amount;
      return {
        id: e.node.id,
        title: e.node.title,
        price: parseFloat(e.node.price.amount).toFixed(2),
        compareAtPrice: compareAt && parseFloat(compareAt) > parseFloat(e.node.price.amount)
          ? parseFloat(compareAt).toFixed(2)
          : null,
        available: e.node.availableForSale
      };
    })
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

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Fetch products from Shopify store sorted by best-selling (Shopify's real sales rank).
 * The first product returned is the actual best seller — no guessing.
 */
export async function fetchProducts(
  shopifyDomain: string,
  storefrontToken?: string,
  limit = 20,
  lang = 'ar'
): Promise<ShopifyProduct[]> {
  try {
    return await fetchProductsOrThrow(shopifyDomain, storefrontToken, limit, lang);
  } catch (error) {
    console.error('❌ Shopify fetchProducts error:', error);
    return [];
  }
}

/**
 * Same as fetchProducts but propagates errors. Use this when the caller
 * needs to distinguish "store empty" from "Shopify unreachable" for UX
 * (e.g. retry button vs no-products greeting).
 */
export async function fetchProductsOrThrow(
  shopifyDomain: string,
  storefrontToken?: string,
  limit = 20,
  lang = 'ar'
): Promise<ShopifyProduct[]> {
  const data = await shopifyGraphQL(shopifyDomain, storefrontToken, PRODUCTS_QUERY, {
    first: limit,
    sortKey: 'BEST_SELLING',
    reverse: false,
    language: lang === 'en' ? 'EN' : 'AR'
  }, lang) as {
    products: { edges: { node: Record<string, unknown> }[] };
  };
  return data.products.edges.map(e => parseProduct(e.node));
}

/**
 * Create a Shopify cart and return a checkout URL (modern Cart API)
 */
export async function createCheckout(
  shopifyDomain: string,
  storefrontToken: string | undefined,
  variantId: string,
  quantity = 1,
  countryCode?: string
): Promise<ShopifyCheckout | null> {
  try {
    const data = await shopifyGraphQL(shopifyDomain, storefrontToken, buildCartMutation(countryCode), { variantId, quantity }) as {
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
  items: { variantId: string; quantity: number }[],
  countryCode?: string
): Promise<ShopifyCheckout | null> {
  try {
    const lines = items.map(item => ({
      merchandiseId: item.variantId,
      quantity: item.quantity
    }));

    const data = await shopifyGraphQL(shopifyDomain, storefrontToken, buildMultiCartMutation(countryCode), { lines }) as {
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
