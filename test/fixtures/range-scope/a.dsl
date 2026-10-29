/**
 * Fragment A - the "first include file". It is included by workspace B (input.dsl).
 * B extends workspace C (c.dsl), and C includes fragment D (d.dsl) where the
 * "Target System" is declared. The reference below must therefore resolve through
 * the chain A -> B -> extends C -> includes D.
 */
A = person "Alice"
A -> T
