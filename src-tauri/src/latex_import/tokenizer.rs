//! Minimal LaTeX tokenizer for the template converter.
//!
//! Not a full LaTeX parser — it recognizes commands, their bracket / brace
//! arguments, environments, math delimiters, and comments. Good enough for
//! template-level conversion; unknown LaTeX is preserved verbatim for the
//! report.

#[derive(Debug, Clone, PartialEq)]
pub enum Token {
    Text(String),
    Command {
        name: String,
        opt: Vec<String>,
        args: Vec<String>,
    },
    BeginEnv {
        name: String,
        opt: Vec<String>,
        args: Vec<String>,
    },
    EndEnv(String),
    Math {
        display: bool,
        body: String,
    },
    Comment(String),
}

pub fn tokenize(src: &str) -> Vec<Token> {
    let bytes: Vec<char> = src.chars().collect();
    let mut i = 0;
    let mut out = Vec::new();
    let mut text = String::new();

    let flush = |text: &mut String, out: &mut Vec<Token>| {
        if !text.is_empty() {
            out.push(Token::Text(std::mem::take(text)));
        }
    };

    while i < bytes.len() {
        let c = bytes[i];
        match c {
            '%' => {
                flush(&mut text, &mut out);
                let start = i + 1;
                while i < bytes.len() && bytes[i] != '\n' {
                    i += 1;
                }
                let s: String = bytes[start..i].iter().collect();
                out.push(Token::Comment(s));
                if i < bytes.len() {
                    i += 1;
                } // consume newline
            }
            '$' => {
                flush(&mut text, &mut out);
                let display = i + 1 < bytes.len() && bytes[i + 1] == '$';
                i += if display { 2 } else { 1 };
                let start = i;
                while i < bytes.len() {
                    if bytes[i] == '\\' && i + 1 < bytes.len() {
                        i += 2;
                        continue;
                    }
                    if bytes[i] == '$' {
                        break;
                    }
                    i += 1;
                }
                let body: String = bytes[start..i].iter().collect();
                i += if display && i + 1 < bytes.len() && bytes[i + 1] == '$' {
                    2
                } else if i < bytes.len() {
                    1
                } else {
                    0
                };
                out.push(Token::Math { display, body });
            }
            '\\' => {
                // Handle \[ \] \( \) math, escaped chars, and commands.
                if i + 1 < bytes.len() {
                    let n = bytes[i + 1];
                    if n == '[' || n == '(' {
                        flush(&mut text, &mut out);
                        let display = n == '[';
                        let (close1, close2) = if display { ('\\', ']') } else { ('\\', ')') };
                        i += 2;
                        let start = i;
                        while i < bytes.len() {
                            if bytes[i] == close1 && i + 1 < bytes.len() && bytes[i + 1] == close2 {
                                break;
                            }
                            i += 1;
                        }
                        let body: String = bytes[start..i].iter().collect();
                        if i < bytes.len() {
                            i += 2;
                        }
                        out.push(Token::Math { display, body });
                        continue;
                    }
                    // Escaped special characters (\%, \&, \$, \#, \_, \{, \}, \~, \^, \\)
                    if matches!(n, '%' | '&' | '$' | '#' | '_' | '{' | '}' | '~' | '^' | '\\' | ' ' | ',' | ';' | ':' | '!')
                        && !n.is_ascii_alphabetic()
                    {
                        // Emit as a command with single-char name so the converter can map it.
                        flush(&mut text, &mut out);
                        out.push(Token::Command {
                            name: n.to_string(),
                            opt: vec![],
                            args: vec![],
                        });
                        i += 2;
                        continue;
                    }
                }

                // Regular command \name
                flush(&mut text, &mut out);
                i += 1;
                let start = i;
                while i < bytes.len() && bytes[i].is_ascii_alphabetic() {
                    i += 1;
                }
                if start == i {
                    // Lone backslash — treat as text
                    text.push('\\');
                    continue;
                }
                // Star variant: \section* etc.
                let mut name: String = bytes[start..i].iter().collect();
                if i < bytes.len() && bytes[i] == '*' {
                    name.push('*');
                    i += 1;
                }
                // Optional whitespace between command and args is allowed in LaTeX.
                let mut opt = Vec::new();
                let mut args = Vec::new();
                loop {
                    let save = i;
                    while i < bytes.len() && bytes[i] == ' ' {
                        i += 1;
                    }
                    if i >= bytes.len() {
                        i = save;
                        break;
                    }
                    match bytes[i] {
                        '[' => {
                            if let Some((arg, next)) = read_balanced(&bytes, i, '[', ']') {
                                opt.push(arg);
                                i = next;
                            } else {
                                i = save;
                                break;
                            }
                        }
                        '{' => {
                            if let Some((arg, next)) = read_balanced(&bytes, i, '{', '}') {
                                args.push(arg);
                                i = next;
                            } else {
                                i = save;
                                break;
                            }
                        }
                        _ => {
                            i = save;
                            break;
                        }
                    }
                }

                match name.as_str() {
                    "begin" if !args.is_empty() => {
                        let env_name = args.remove(0);
                        // After \begin{env}, some envs take further [opt]/{args} (figure[t], tabular{cc}).
                        let mut env_opt = opt;
                        let mut env_args = args;
                        loop {
                            let save = i;
                            while i < bytes.len() && bytes[i] == ' ' {
                                i += 1;
                            }
                            if i >= bytes.len() {
                                i = save;
                                break;
                            }
                            match bytes[i] {
                                '[' => {
                                    if let Some((a, n)) = read_balanced(&bytes, i, '[', ']') {
                                        env_opt.push(a);
                                        i = n;
                                    } else {
                                        i = save;
                                        break;
                                    }
                                }
                                '{' => {
                                    if let Some((a, n)) = read_balanced(&bytes, i, '{', '}') {
                                        env_args.push(a);
                                        i = n;
                                    } else {
                                        i = save;
                                        break;
                                    }
                                }
                                _ => {
                                    i = save;
                                    break;
                                }
                            }
                        }
                        out.push(Token::BeginEnv {
                            name: env_name,
                            opt: env_opt,
                            args: env_args,
                        });
                    }
                    "end" if !args.is_empty() => {
                        out.push(Token::EndEnv(args.remove(0)));
                    }
                    _ => out.push(Token::Command { name, opt, args }),
                }
            }
            _ => {
                text.push(c);
                i += 1;
            }
        }
    }
    flush(&mut text, &mut out);
    out
}

/// Read a balanced group starting at `start` (which must point at `open`).
/// Returns (inner, index-after-close).
fn read_balanced(bytes: &[char], start: usize, open: char, close: char) -> Option<(String, usize)> {
    if bytes.get(start)? != &open {
        return None;
    }
    let mut depth = 1;
    let mut i = start + 1;
    let body_start = i;
    while i < bytes.len() {
        match bytes[i] {
            '\\' if i + 1 < bytes.len() => {
                i += 2;
                continue;
            }
            c if c == open => depth += 1,
            c if c == close => {
                depth -= 1;
                if depth == 0 {
                    let s: String = bytes[body_start..i].iter().collect();
                    return Some((s, i + 1));
                }
            }
            _ => {}
        }
        i += 1;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokenizes_simple_command() {
        let t = tokenize("\\section{Intro}");
        assert_eq!(t.len(), 1);
        match &t[0] {
            Token::Command { name, args, .. } => {
                assert_eq!(name, "section");
                assert_eq!(args, &vec!["Intro".to_string()]);
            }
            _ => panic!(),
        }
    }

    #[test]
    fn tokenizes_nested_braces() {
        let t = tokenize("\\textbf{very \\textit{bold} text}");
        assert_eq!(t.len(), 1);
        if let Token::Command { args, .. } = &t[0] {
            assert_eq!(args[0], "very \\textit{bold} text");
        } else {
            panic!()
        }
    }

    #[test]
    fn tokenizes_environment() {
        let t = tokenize("\\begin{figure}[t]\\end{figure}");
        assert_eq!(t.len(), 2);
        assert!(matches!(&t[0], Token::BeginEnv { name, opt, .. } if name == "figure" && opt == &vec!["t".to_string()]));
        assert!(matches!(&t[1], Token::EndEnv(n) if n == "figure"));
    }

    #[test]
    fn tokenizes_inline_math() {
        let t = tokenize("text $x^2$ more");
        assert_eq!(t.len(), 3);
        assert!(matches!(&t[1], Token::Math { display: false, body } if body == "x^2"));
    }

    #[test]
    fn tokenizes_display_math_brackets() {
        let t = tokenize("before \\[ a = b \\] after");
        assert!(t.iter().any(|tok| matches!(tok, Token::Math { display: true, body } if body.trim() == "a = b")));
    }

    #[test]
    fn tokenizes_comment() {
        let t = tokenize("a % comment\nb");
        assert!(t.iter().any(|tok| matches!(tok, Token::Comment(c) if c == " comment")));
    }

    #[test]
    fn tokenizes_star_variant() {
        let t = tokenize("\\section*{x}");
        if let Token::Command { name, .. } = &t[0] {
            assert_eq!(name, "section*");
        } else {
            panic!()
        }
    }

    #[test]
    fn tokenizes_optional_arg() {
        let t = tokenize("\\cite[p.~3]{foo}");
        if let Token::Command { opt, args, .. } = &t[0] {
            assert_eq!(opt, &vec!["p.~3".to_string()]);
            assert_eq!(args, &vec!["foo".to_string()]);
        } else {
            panic!()
        }
    }
}
