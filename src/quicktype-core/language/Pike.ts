import { ConvenienceRenderer, ForbiddenWordsInfo } from "../ConvenienceRenderer";
import { Name, Namer, funPrefixNamer } from "../Naming";
import { Option } from "../RendererOptions";
import { RenderContext } from "../Renderer";
import { MultiWord, Sourcelike, modifySource, multiWord, parenIfNeeded, singleWord } from "../Source";
import { TargetLanguage } from "../TargetLanguage";
import { Type, ClassType, EnumType, UnionType } from "../Type";
import { matchType, nullableFromUnion, removeNullFromUnion } from "../TypeUtils";
import {
    camelCase,
    legalizeCharacters,
    isLetterOrUnderscoreOrDigit,
    stringEscape,
    makeNameStyle
} from "../support/Strings";

export const pikeOptions = {};

const keywords = [
    "nomask",
    "final",
    "static",
    "extern",
    "private",
    "local",
    "public",
    "protected",
    "inline",
    "optional",
    "variant",
    "void",
    "mixed",
    "array",
    "__attribute__",
    "__deprecated__",
    "mapping",
    "multiset",
    "object",
    "function",
    "__func__",
    "program",
    "string",
    "float",
    "int",
    "enum",
    "typedef",
    "if",
    "do",
    "for",
    "while",
    "else",
    "foreach",
    "catch",
    "gauge",
    "class",
    "break",
    "case",
    "constant",
    "continue",
    "default",
    "import",
    "inherit",
    "lambda",
    "predef",
    "return",
    "sscanf",
    "switch",
    "typeof",
    "global"
];

const legalizeName = legalizeCharacters(isLetterOrUnderscoreOrDigit);
const namingFunction = funPrefixNamer("namer", makeNameStyle("underscore", legalizeName));
const namedTypeNamingFunction = funPrefixNamer("namer", makeNameStyle("pascal", legalizeName));

export class PikeTargetLanguage extends TargetLanguage {
    constructor() {
        super("Pike", ["pike", "pikelang"], "Pike");
    }
    protected getOptions(): Option<any>[] {
        return [];
    }

    protected makeRenderer(renderContext: RenderContext): PikeRenderer {
        return new PikeRenderer(this, renderContext);
    }
}

export class PikeRenderer extends ConvenienceRenderer {
    protected emitSourceStructure(): void {
        this.forEachNamedType(
            "leading-and-interposing",
            (c: ClassType, className: Name) => this.emitClassDefinition(c, className),
            (e, n) => this.emitEnum(e, n),
            (u, n) => this.emitUnion(u, n)
        );
        this.emitConvertModule();
    }

    protected makeEnumCaseNamer(): Namer {
        return namingFunction;
    }
    protected makeNamedTypeNamer(): Namer {
        return namedTypeNamingFunction;
    }

    protected makeUnionMemberNamer(): Namer {
        return namingFunction;
    }

    protected namerForObjectProperty(): Namer {
        return namingFunction;
    }

    protected forbiddenNamesForGlobalNamespace(): string[] {
        return [...keywords];
    }

    protected forbiddenForObjectProperties(_c: ClassType, _className: Name): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    protected forbiddenForEnumCases(_e: EnumType, _enumName: Name): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    protected forbiddenForUnionMembers(_u: UnionType, _unionName: Name): ForbiddenWordsInfo {
        return { names: [], includeGlobalForbidden: true };
    }

    protected sourceFor(t: Type): MultiWord {
        if (["class", "object", "enum"].indexOf(t.kind) >= 0) {
            return singleWord(this.nameForNamedType(t));
        }
        return matchType<MultiWord>(
            t,
            _anyType => singleWord("mixed"),
            _nullType => singleWord("mixed"),
            _boolType => singleWord("bool"),
            _integerType => singleWord("int"),
            _doubleType => singleWord("float"),
            _stringType => singleWord("string"),
            arrayType => singleWord(["array(", this.sourceFor(arrayType.items).source, ")"]),
            _classType => singleWord(this.nameForNamedType(_classType)),
            mapType => {
                let valueSource: Sourcelike;
                const v = mapType.values;

                valueSource = this.sourceFor(v).source;
                return singleWord(["mapping(string:", valueSource, ")"]);
            },
            _enumType => singleWord("enum"),
            unionType => {
                if (nullableFromUnion(unionType) !== null) {
                    const children = Array.from(unionType.getChildren()).map(c => parenIfNeeded(this.sourceFor(c)));
                    return multiWord("|", ...children);
                } else {
                    return singleWord(this.nameForNamedType(unionType));
                }
            }
        );
    }

    protected emitClassDefinition(c: ClassType, className: Name): void {
        this.emitDescription(this.descriptionForType(c));
        this.emitBlock(["class ", className], () => {
            this.emitClassMembers(c);
        });
    }

    protected emitEnum(e: EnumType, enumName: Name): void {
        this.emitBlock([e.kind, " ", enumName], () => {
            let table: Sourcelike[][] = [];
            this.forEachEnumCase(e, "none", (name, jsonName) => {
                table.push([[name, ", "], ['// json: "', stringEscape(jsonName), '"']]);
            });
            this.emitTable(table);
        });
    }

    protected emitUnion(u: UnionType, unionName: Name): void {
        const isMaybeWithSingleType = nullableFromUnion(u);

        if (isMaybeWithSingleType !== null) {
            return;
        }

        this.emitDescription(this.descriptionForType(u));

        const [, nonNulls] = removeNullFromUnion(u);

        let types: Sourcelike[][] = [];
        this.forEachUnionMember(u, nonNulls, "none", null, (_name, t) => {
            const pikeType = this.sourceFor(t).source;
            types.push([pikeType]);
        });

        this.emitLine([
            "typedef ",
            types.map(r => r.map(sl => this.sourcelikeToString(sl))).join("|"),
            " ",
            unionName,
            ";"
        ]);
    }

    private emitConvertModule(): void {
        this.emitBlock(["class Convert "], () => {
            this.emitConvertModuleBody();
        });
    }

    private emitConvertModuleBody(): void {
        this.forEachTopLevel("leading-and-interposing", (t, name) => {
            this.emitBlock([this.deserializerFunctionLine(t, name), " "], () => {});
            this.ensureBlankLine();
            this.emitBlock([this.serializerFunctionLine(t, name), " "], () => {});
        });
    }

    private emitBlock(line: Sourcelike, f: () => void): void {
        this.emitLine(line, " {");
        this.indent(f);
        this.emitLine("}");
    }

    private emitClassMembers(c: ClassType): void {
        let table: Sourcelike[][] = [];
        this.forEachClassProperty(c, "none", (name, jsonName, p) => {
            const pikeType = this.sourceFor(p.type).source;

            table.push([[pikeType, " "], [name, "; "], ['// json: "', stringEscape(jsonName), '"']]);
        });
        this.emitTable(table);
    }

    private deserializerFunctionName(name: Name): Sourcelike {
        return ["to_", name];
    }

    private deserializerFunctionLine(_t: Type, name: Name): Sourcelike {
        return [name, " ", this.deserializerFunctionName(name), "(string json_str)"];
    }

    private serializerFunctionName(name: Name): Sourcelike {
        return [name, "_to_json"];
    }

    private serializerFunctionLine(_t: Type, name: Name): Sourcelike {
        return ["string ", this.serializerFunctionName(name), "(", name, " value)"];
    }
}
