/**
 * 언어별 예약어.
 *
 * 하이라이팅에만 쓴다. 예약어를 클릭 후보에서 빼는 것이 유일한 기능적 효과다 —
 * `if` 나 `return` 을 눌러 정의를 찾으려는 사람은 없다.
 */

const KEYWORDS: Record<string, string> = {
    cpp: 'alignas alignof and and_eq asm atomic_cancel atomic_commit atomic_noexcept auto bitand bitor bool break case catch char char8_t char16_t char32_t class compl concept const consteval constexpr constinit const_cast continue co_await co_return co_yield decltype default delete do double dynamic_cast else enum explicit export extern false float for friend goto if inline int long mutable namespace new noexcept not not_eq nullptr operator or or_eq private protected public register reinterpret_cast requires return short signed sizeof static static_assert static_cast struct switch template this thread_local throw true try typedef typeid typename union unsigned using virtual void volatile wchar_t while xor xor_eq override final int8_t int16_t int32_t int64_t uint8_t uint16_t uint32_t uint64_t size_t',
    c: 'auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while bool true false NULL size_t',
    csharp: 'abstract as async await base bool break byte case catch char checked class const continue decimal default delegate do double dynamic else enum event explicit extern false finally fixed float for foreach get goto if implicit in init int interface internal is lock long nameof namespace new nint nuint null object operator out override params partial private protected public readonly record ref return sbyte sealed set short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using value var virtual void volatile when where while yield with global required scoped file',
    go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false iota bool byte complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune string uint uint8 uint16 uint32 uint64 uintptr any make new len cap append copy delete panic recover close',
    rust: 'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type union unsafe use where while abstract become box do final macro override priv typeof unsized virtual yield try i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str String Vec Option Result Some None Ok Err Box Rc Arc',
    typescript: 'abstract any as asserts async await boolean break case catch class const constructor continue declare default delete do else enum export extends false finally for from function get if implements import in infer instanceof interface is keyof let module namespace never new null number object of package private protected public readonly require return set static string super switch symbol this throw true try type typeof undefined union unique unknown var void while with yield',
    javascript: 'async await break case catch class const continue debugger default delete do else export extends false finally for from function get if import in instanceof let new null of return set static super switch this throw true try typeof undefined var void while with yield',
    python: 'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield self',
    java: 'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new null package private protected public return short static strictfp super switch synchronized this throw throws transient true false try var void volatile while record sealed permits yield',
};

const SETS = new Map<string, ReadonlySet<string>>(
    Object.entries(KEYWORDS).map(([language, words]) => [
        language,
        new Set(words.split(/\s+/).filter((w) => w !== '')),
    ]),
);

/**
 * 이 언어의 예약어 집합.
 *
 * 모르는 언어는 C 계열 기본값으로 둔다. 하이라이팅이 조금 틀릴 뿐 클릭 좌표는
 * 영향을 받지 않는다 — 정확도는 언어 서버가 책임진다.
 */
export function keywordSet(languageId: string): ReadonlySet<string> {
    const direct = SETS.get(languageId);
    if (direct) {
        return direct;
    }
    switch (languageId) {
        case 'cuda-cpp':
        case 'objective-cpp':
            return SETS.get('cpp') as ReadonlySet<string>;
        case 'objective-c':
            return SETS.get('c') as ReadonlySet<string>;
        case 'typescriptreact':
            return SETS.get('typescript') as ReadonlySet<string>;
        case 'javascriptreact':
            return SETS.get('javascript') as ReadonlySet<string>;
        default:
            return SETS.get('cpp') as ReadonlySet<string>;
    }
}
