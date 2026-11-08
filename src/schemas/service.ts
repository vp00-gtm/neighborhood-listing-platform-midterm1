// Share the existing strict rules with service editing so validation cannot
// drift. category_ids remains an explicitly validated optional extension.
export { serviceInputSchema as serviceSchema } from "@/lib/exam-schemas";
