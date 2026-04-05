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

const CREATE_CHECKOUT_MUTATION = `
  mutation createCheckout($variantId: ID!, $quantity: Int!) {
    checkoutCreate(input: {
      lineItems: [{ variantId: $variantId, quantity: $quantity }]
    }) {
      checkout {
        webUrl
        totalPriceV2 { amount currencyCode }
      }
      checkoutUserErrors {
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
  storefrontToken: string,
  query: string,
  variables: Record<string, unknown>
): Promise<unknown> {
  const url = `https://${shopifyDomain}/api/2026-04/graphql.json`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': storefrontToken
    },
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

/** Format a price amount as a locale-formatted number (no currency symbol — templates add "ريال") */
export function formatPriceSAR(amount: string | number): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return '0';
  return num.toLocaleString('ar-SA', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Fetch products from Shopify store (up to 20 by default)
 */
export async function fetchProducts(
  shopifyDomain: string,
  storefrontToken: string,
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
  storefrontToken: string,
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
  storefrontToken: string,
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
 * Create a Shopify checkout (returns a payment URL)
 */
export async function createCheckout(
  shopifyDomain: string,
  storefrontToken: string,
  variantId: string,
  quantity = 1
): Promise<ShopifyCheckout | null> {
  try {
    const data = await shopifyGraphQL(shopifyDomain, storefrontToken, CREATE_CHECKOUT_MUTATION, { variantId, quantity }) as {
      checkoutCreate: {
        checkout: { webUrl: string; totalPriceV2: { amount: string } } | null;
        checkoutUserErrors: { field: string; message: string }[];
      };
    };

    const result = data.checkoutCreate;

    if (result.checkoutUserErrors.length > 0) {
      console.error('❌ Shopify checkout errors:', result.checkoutUserErrors);
      return null;
    }

    if (!result.checkout) return null;

    return {
      checkoutUrl: result.checkout.webUrl,
      totalPrice: parseFloat(result.checkout.totalPriceV2.amount).toFixed(2)
    };
  } catch (error) {
    console.error('❌ Shopify createCheckout error:', error);
    return null;
  }
}
