declare module "mjml" {
  export interface MJMLParseResults {
    html: string;
    errors?: any[];
  }
  export default function mjml2html(input: string, options?: any): MJMLParseResults;
}
