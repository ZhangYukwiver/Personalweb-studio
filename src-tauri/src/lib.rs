use std::{fs, time::Duration};

use chrono::Utc;
use reqwest::{StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const MAX_HTML_LENGTH: usize = 100_000;
const MAX_CSS_LENGTH: usize = 150_000;
const MAX_EFFECTS: usize = 32;
const MAX_ATTACHMENT_BYTES: usize = 8 * 1024 * 1024;
const MAX_OUTPUT_TOKENS: u64 = 12_000;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct GeneratePageDesignRequest {
    prompt: String,
    profile: AiProfileSnapshot,
    attachments: Vec<AiAttachmentInput>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiProviderConfig {
    base_url: String,
    model: String,
    api_format: AiApiFormat,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
enum AiApiFormat {
    Responses,
    ChatCompletions,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiProfileSnapshot {
    name: String,
    headline: String,
    bio: String,
    email: String,
    location: String,
    accent_color: String,
    has_avatar: bool,
    skills: Vec<String>,
    projects: Vec<AiProjectSnapshot>,
    socials: Vec<AiSocialSnapshot>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiProjectSnapshot {
    title: String,
    description: String,
    tags: Vec<String>,
    has_image: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct AiSocialSnapshot {
    label: String,
    url: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct AiAttachmentInput {
    name: String,
    src: String,
    intent: String,
    bytes: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct GeneratedPageDesign {
    version: u8,
    body_html: String,
    css: String,
    effects: Vec<GeneratedEffect>,
    created_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct GeneratedEffect {
    #[serde(rename = "targetId")]
    target_id: String,
    #[serde(rename = "type")]
    effect_type: String,
    intensity: Option<f64>,
}

#[tauri::command]
fn save_html_file(path: String, content: String) -> Result<(), String> {
    fs::write(path, content).map_err(|error| format!("无法保存文件：{error}"))
}

#[tauri::command]
async fn generate_page_design(
    request: GeneratePageDesignRequest,
    api_key: String,
    provider: AiProviderConfig,
) -> Result<GeneratedPageDesign, String> {
    generate_page_design_at(request, api_key.trim(), &provider, REQUEST_TIMEOUT).await
}

async fn generate_page_design_at(
    request: GeneratePageDesignRequest,
    api_key: &str,
    provider: &AiProviderConfig,
    timeout: Duration,
) -> Result<GeneratedPageDesign, String> {
    validate_request(&request, api_key)?;
    let endpoint = normalize_ai_endpoint(provider)?;
    let body = create_openai_request(&request, provider)?;
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|_| "无法初始化 AI 请求。".to_string())?;
    let response = client
        .post(endpoint)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(map_request_error)?;
    let status = response.status();
    if !status.is_success() {
        return Err(status_error(status));
    }
    let response_body = response
        .bytes()
        .await
        .map_err(|_| "读取 AI 接口返回结果失败。".to_string())?;
    if response_body.len() > 2 * 1024 * 1024 {
        return Err("AI 接口返回内容超过 2MB 限制。".to_string());
    }
    parse_openai_response(&response_body, provider.api_format)
}

fn normalize_ai_endpoint(provider: &AiProviderConfig) -> Result<Url, String> {
    let model = provider.model.trim();
    if model.is_empty() || model.len() > 200 || model.chars().any(char::is_whitespace) {
        return Err("请输入有效的模型名称。".to_string());
    }

    let mut url = Url::parse(provider.base_url.trim())
        .map_err(|_| "请输入有效的 API Base URL。".to_string())?;
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("API Base URL 不能包含账号、查询参数或锚点。".to_string());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "API Base URL 缺少有效主机名。".to_string())?;
    let loopback = matches!(host, "localhost" | "127.0.0.1" | "::1");
    if url.scheme() != "https" && !(url.scheme() == "http" && loopback) {
        return Err("公网 AI 接口必须使用 HTTPS；HTTP 仅允许本机地址。".to_string());
    }

    let path = url
        .path()
        .trim_end_matches('/')
        .strip_suffix("/responses")
        .or_else(|| {
            url.path()
                .trim_end_matches('/')
                .strip_suffix("/chat/completions")
        })
        .unwrap_or_else(|| url.path().trim_end_matches('/'));
    let endpoint_path = match provider.api_format {
        AiApiFormat::Responses => format!("{path}/responses"),
        AiApiFormat::ChatCompletions => format!("{path}/chat/completions"),
    };
    url.set_path(&endpoint_path);
    Ok(url)
}

fn validate_request(request: &GeneratePageDesignRequest, api_key: &str) -> Result<(), String> {
    if api_key.is_empty() || api_key.len() > 512 {
        return Err("请输入有效的 OpenAI API Key。".to_string());
    }
    if request.prompt.chars().count() > 2_000 {
        return Err("修改要求超过 2000 字限制。".to_string());
    }
    if request.prompt.trim().is_empty() && request.attachments.is_empty() {
        return Err("请添加参考截图或填写修改要求。".to_string());
    }
    if request.attachments.len() > 3 {
        return Err("最多添加 3 张截图。".to_string());
    }
    let mut total_bytes = 0usize;
    for attachment in &request.attachments {
        if attachment.name.chars().count() > 200
            || !matches!(attachment.intent.as_str(), "reference" | "target")
            || !is_supported_image_data_url(&attachment.src)
        {
            return Err("参考截图格式无效。".to_string());
        }
        let payload_bytes = data_url_payload_bytes(&attachment.src)
            .ok_or_else(|| "参考截图格式无效。".to_string())?;
        if payload_bytes > 4 * 1024 * 1024 || attachment.bytes != payload_bytes {
            return Err("参考截图大小信息无效。".to_string());
        }
        total_bytes = total_bytes
            .checked_add(payload_bytes)
            .ok_or_else(|| "参考截图总大小无效。".to_string())?;
    }
    if total_bytes > MAX_ATTACHMENT_BYTES {
        return Err("截图压缩后的总大小不能超过 8MB。".to_string());
    }
    let profile_bytes = serde_json::to_vec(&request.profile)
        .map_err(|_| "个人资料无法序列化。".to_string())?
        .len();
    if profile_bytes > 100_000 {
        return Err("个人资料内容超过 100KB 限制。".to_string());
    }
    Ok(())
}

fn is_supported_image_data_url(value: &str) -> bool {
    [
        "data:image/jpeg;base64,",
        "data:image/png;base64,",
        "data:image/webp;base64,",
    ]
    .iter()
    .any(|prefix| value.starts_with(prefix))
}

fn data_url_payload_bytes(value: &str) -> Option<usize> {
    let payload = value.split_once(',')?.1;
    if payload.is_empty()
        || payload.len() % 4 != 0
        || payload
            .bytes()
            .any(|byte| !(byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/' | b'=')))
    {
        return None;
    }
    let padding = payload
        .bytes()
        .rev()
        .take_while(|byte| *byte == b'=')
        .count();
    payload
        .len()
        .checked_mul(3)?
        .checked_div(4)?
        .checked_sub(padding)
}

fn create_openai_request(
    request: &GeneratePageDesignRequest,
    provider: &AiProviderConfig,
) -> Result<Value, String> {
    let context = serde_json::to_string(&json!({
        "modificationRequest": request.prompt,
        "profile": request.profile,
        "attachments": request.attachments.iter().map(|attachment| json!({
            "name": attachment.name,
            "intent": attachment.intent
        })).collect::<Vec<_>>()
    }))
    .map_err(|_| "无法准备生成资料。".to_string())?;

    match provider.api_format {
        AiApiFormat::Responses => create_responses_request(request, provider.model.trim(), context),
        AiApiFormat::ChatCompletions => {
            create_chat_completions_request(request, provider.model.trim(), context)
        }
    }
}

fn create_responses_request(
    request: &GeneratePageDesignRequest,
    model: &str,
    context: String,
) -> Result<Value, String> {
    let mut content = vec![json!({
        "type": "input_text",
        "text": user_context(&context)
    })];
    for attachment in &request.attachments {
        content.push(json!({
            "type": "input_image",
            "image_url": attachment.src,
            "detail": "high"
        }));
    }

    Ok(json!({
        "model": model,
        "store": false,
        "max_output_tokens": MAX_OUTPUT_TOKENS,
        "input": [
            {
                "role": "developer",
                "content": [{
                    "type": "input_text",
                    "text": design_instructions()
                }]
            },
            {
                "role": "user",
                "content": content
            }
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "generated_page_design",
                "strict": true,
                "schema": generated_design_schema()
            }
        }
    }))
}

fn create_chat_completions_request(
    request: &GeneratePageDesignRequest,
    model: &str,
    context: String,
) -> Result<Value, String> {
    let mut content = vec![json!({
        "type": "text",
        "text": user_context(&context)
    })];
    for attachment in &request.attachments {
        content.push(json!({
            "type": "image_url",
            "image_url": {
                "url": attachment.src,
                "detail": "high"
            }
        }));
    }

    let schema = serde_json::to_string(&generated_design_schema())
        .map_err(|_| "无法准备生成格式。".to_string())?;
    Ok(json!({
        "model": model,
        "max_tokens": MAX_OUTPUT_TOKENS,
        "messages": [
            {
                "role": "system",
                "content": format!("{}\nReturn only one JSON object matching this JSON Schema. Do not wrap it in commentary:\n{schema}", design_instructions())
            },
            {
                "role": "user",
                "content": content
            }
        ]
    }))
}

fn user_context(context: &str) -> String {
    format!("Use this user-owned source data and request as design context. Do not copy text or assets from the reference screenshots. Source data:\n{context}")
}

fn design_instructions() -> &'static str {
    r#"Create one original, immersive personal portfolio design for desktop only.
Return semantic HTML body markup, CSS, and trusted effect declarations. Never generate JavaScript.
Use the reference screenshots only for visual language, hierarchy, pacing, and interaction rhythm. Do not reproduce their words, logos, images, or source code.
The user's profile is the only source of personal facts. Do not hard-code those facts into the HTML. Render them only through these data slots:
name, headline, bio, avatar, skills, projects, contact.
The HTML must include name, headline, bio, skills, projects, and contact at least once using data-slot attributes. The avatar slot is optional.
Allowed tags: header, main, section, article, div, nav, footer, h1, h2, h3, p, span, ul, ol, li, a, strong, em, small, blockquote, figure, figcaption, hr.
Allowed attributes: id, class, href, target, rel, aria-label, aria-hidden, role, data-slot.
Every effect targetId must reference a unique HTML id. Allowed effects: reveal, parallax, sticky, marquee, section-snap, media-swap, scene-pin, particle-field. Use at most 32 effects and intensity from 0 to 1 or null.
Use particle-field on at most two large sections; the trusted runtime injects the canvas, so do not add canvas markup.
For a pinned editorial sequence, create an inner container with a unique id and 2 to 5 direct children using the pf-scene-step class, then apply scene-pin to that container.
For a pinned project image sequence, create an inner container with a unique id that contains the projects data slot, then apply media-swap to that container. Use media-swap at most twice. The trusted runtime turns the rendered project cards into scroll-driven media frames.
When the reference implies immersive scroll storytelling, prefer one particle-field, one scene-pin sequence, and one media-swap project sequence so the result demonstrates the complete interaction rhythm.
CSS must be self-contained. Do not use url(), @import, @font-face, external resources, external stylesheets, forms, iframe, SVG, script, event attributes, or inline style attributes.
Design for a minimum 980px desktop canvas. Do not add mobile breakpoints or claim mobile support. Keep all text readable with long Chinese content and missing images."#
}

fn generated_design_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "version": { "type": "integer", "enum": [1] },
            "bodyHtml": { "type": "string" },
            "css": { "type": "string" },
            "effects": {
                "type": "array",
                "maxItems": MAX_EFFECTS,
                "items": {
                    "type": "object",
                    "properties": {
                        "targetId": { "type": "string" },
                        "type": {
                            "type": "string",
                            "enum": ["reveal", "parallax", "sticky", "marquee", "section-snap", "media-swap", "scene-pin", "particle-field"]
                        },
                        "intensity": {
                            "anyOf": [
                                { "type": "number", "minimum": 0, "maximum": 1 },
                                { "type": "null" }
                            ]
                        }
                    },
                    "required": ["targetId", "type", "intensity"],
                    "additionalProperties": false
                }
            },
            "createdAt": { "type": "string" }
        },
        "required": ["version", "bodyHtml", "css", "effects", "createdAt"],
        "additionalProperties": false
    })
}

fn map_request_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        "AI 接口请求超时，5 分钟内未返回。服务商可能仍在处理，请先检查用量记录，再决定是否重新生成。"
            .to_string()
    } else if error.is_connect() {
        "无法连接 AI 接口，请检查地址和网络后重试。".to_string()
    } else {
        "AI 接口请求失败，请重试。".to_string()
    }
}

fn status_error(status: StatusCode) -> String {
    match status.as_u16() {
        401 => {
            "API Key 未被接口接受。请从服务商的 API Keys 页面复制完整密钥，输入时不要包含 Bearer、引号或额外空格。"
                .to_string()
        }
        403 => {
            "API Key 已识别，但没有所选接口或当前模型的访问权限。请检查接口格式、密钥分组、状态、额度和模型权限。"
                .to_string()
        }
        429 => "请求过于频繁或额度不足，请稍后重试。".to_string(),
        502 => {
            "中转站或上游模型暂时不可用（HTTP 502）。请先检查服务商用量记录，再尝试减少截图、切换模型或使用该服务商的备用节点。"
                .to_string()
        }
        500..=599 => format!("AI 服务暂时不可用（HTTP {}）。", status.as_u16()),
        _ => format!("AI 接口拒绝了请求（HTTP {}）。", status.as_u16()),
    }
}

fn parse_openai_response(
    body: &[u8],
    api_format: AiApiFormat,
) -> Result<GeneratedPageDesign, String> {
    let response: Value =
        serde_json::from_slice(body).map_err(|_| "AI 接口返回格式异常。".to_string())?;
    if response.get("error").is_some_and(|error| !error.is_null()) {
        return Err("AI 接口返回了请求错误。".to_string());
    }

    match api_format {
        AiApiFormat::Responses => parse_responses_output(&response),
        AiApiFormat::ChatCompletions => parse_chat_completions_output(&response),
    }
}

fn parse_responses_output(response: &Value) -> Result<GeneratedPageDesign, String> {
    if response.get("status").and_then(Value::as_str) == Some("incomplete") {
        return Err("AI 接口未能完整生成页面，请缩短要求后重试。".to_string());
    }

    let output = response
        .get("output")
        .and_then(Value::as_array)
        .ok_or_else(|| "OpenAI 返回格式异常。".to_string())?;
    for item in output {
        let Some(parts) = item.get("content").and_then(Value::as_array) else {
            continue;
        };
        for part in parts {
            if part.get("type").and_then(Value::as_str) == Some("refusal") {
                return Err("AI 接口拒绝生成当前请求。".to_string());
            }
            if part.get("type").and_then(Value::as_str) != Some("output_text") {
                continue;
            }
            let text = part
                .get("text")
                .and_then(Value::as_str)
                .ok_or_else(|| "AI 接口返回格式异常。".to_string())?;
            return parse_generated_design_text(text);
        }
    }
    Err("AI 接口没有返回可用的页面设计。".to_string())
}

fn parse_chat_completions_output(response: &Value) -> Result<GeneratedPageDesign, String> {
    let choice = response
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .ok_or_else(|| "OpenAI 返回格式异常。".to_string())?;
    if choice.get("finish_reason").and_then(Value::as_str) == Some("length") {
        return Err("AI 接口未能完整生成页面，请缩短要求后重试。".to_string());
    }
    let message = choice
        .get("message")
        .ok_or_else(|| "OpenAI 返回格式异常。".to_string())?;
    if message
        .get("refusal")
        .is_some_and(|refusal| !refusal.is_null())
    {
        return Err("AI 接口拒绝生成当前请求。".to_string());
    }
    let content = message
        .get("content")
        .ok_or_else(|| "AI 接口没有返回可用的页面设计。".to_string())?;
    if let Some(text) = content.as_str() {
        return parse_generated_design_text(text);
    }
    if let Some(parts) = content.as_array() {
        for part in parts {
            if part.get("type").and_then(Value::as_str) == Some("text") {
                if let Some(text) = part.get("text").and_then(Value::as_str) {
                    return parse_generated_design_text(text);
                }
            }
        }
    }
    Err("AI 接口没有返回可用的页面设计。".to_string())
}

fn parse_generated_design_text(text: &str) -> Result<GeneratedPageDesign, String> {
    let trimmed = text.trim();
    let json_text = if let Some(fenced) = trimmed.strip_prefix("```") {
        let (_, content) = fenced
            .split_once('\n')
            .ok_or_else(|| "AI 接口返回的页面格式异常。".to_string())?;
        content
            .strip_suffix("```")
            .map(str::trim)
            .ok_or_else(|| "AI 接口返回的页面格式异常。".to_string())?
    } else {
        trimmed
    };
    let mut design: GeneratedPageDesign =
        serde_json::from_str(json_text).map_err(|_| "AI 接口返回的页面格式异常。".to_string())?;
    validate_generated_design(&design)?;
    design.created_at = Utc::now().to_rfc3339();
    Ok(design)
}

fn validate_generated_design(design: &GeneratedPageDesign) -> Result<(), String> {
    if design.version != 1 {
        return Err("AI 接口返回的页面版本无效。".to_string());
    }
    if design.body_html.len() > MAX_HTML_LENGTH
        || design.css.len() > MAX_CSS_LENGTH
        || design.effects.len() > MAX_EFFECTS
    {
        return Err("AI 接口返回的页面超过安全限制。".to_string());
    }
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            save_html_file,
            generate_page_design
        ])
        .run(tauri::generate_context!())
        .expect("启动主页工坊失败")
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use serde_json::json;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
        time::sleep,
    };

    use super::{
        create_openai_request, generate_page_design_at, normalize_ai_endpoint, save_html_file,
        AiApiFormat, AiAttachmentInput, AiProfileSnapshot, AiProjectSnapshot, AiProviderConfig,
        AiSocialSnapshot, GeneratePageDesignRequest, MAX_OUTPUT_TOKENS,
    };

    #[test]
    fn saves_exported_html_to_disk() {
        let path = std::env::temp_dir().join(format!(
            "homepage-forge-export-test-{}.html",
            std::process::id()
        ));
        let content = "<!doctype html><title>测试主页</title>";

        save_html_file(path.to_string_lossy().into_owned(), content.into()).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), content);
        std::fs::remove_file(path).unwrap();
    }

    #[tokio::test]
    async fn generates_a_structured_design() {
        let design = valid_design();
        let body = json!({
            "status": "completed",
            "output": [{
                "type": "message",
                "content": [{
                    "type": "output_text",
                    "text": serde_json::to_string(&design).unwrap()
                }]
            }]
        })
        .to_string();
        let endpoint = mock_endpoint(200, body, Duration::ZERO).await;
        let provider = test_provider(endpoint);

        let result = generate_page_design_at(
            valid_request(),
            "test-session-key",
            &provider,
            Duration::from_secs(1),
        )
        .await
        .unwrap();

        assert_eq!(result.version, 1);
        assert!(result.body_html.contains("data-slot=\"projects\""));
        assert!(!result.created_at.is_empty());
    }

    #[tokio::test]
    async fn generates_a_design_from_chat_completions() {
        let content = format!(
            "```json\n{}\n```",
            serde_json::to_string(&valid_design()).unwrap()
        );
        let body = json!({
            "choices": [{
                "finish_reason": "stop",
                "message": { "role": "assistant", "content": content }
            }]
        })
        .to_string();
        let endpoint = mock_endpoint(200, body, Duration::ZERO).await;
        let provider = test_chat_provider(endpoint);

        let result = generate_page_design_at(
            valid_request(),
            "test-session-key",
            &provider,
            Duration::from_secs(1),
        )
        .await
        .unwrap();

        assert_eq!(result.version, 1);
        assert!(result.body_html.contains("data-slot=\"projects\""));
    }

    #[test]
    fn builds_a_stateless_high_detail_request_without_the_api_key() {
        let mut request = valid_request();
        request.attachments.push(AiAttachmentInput {
            name: "reference.jpg".into(),
            src: "data:image/jpeg;base64,YQ==".into(),
            intent: "reference".into(),
            bytes: 1,
        });

        let body = create_openai_request(&request, &test_provider("https://example.com/v1".into()))
            .unwrap();
        let serialized = body.to_string();

        assert_eq!(body["model"], "provider-model");
        assert_eq!(body["store"], false);
        assert_eq!(body["max_output_tokens"], MAX_OUTPUT_TOKENS);
        assert_eq!(body["input"][1]["content"][1]["detail"], "high");
        assert!(body.get("reasoning").is_none());
        assert!(body["text"].get("verbosity").is_none());
        assert!(!serialized.contains("API Key"));
        assert!(!serialized.contains("test-session-key"));
        assert!(serialized.contains("scene-pin"));
        assert!(serialized.contains("particle-field"));
    }

    #[test]
    fn builds_a_compatible_chat_completions_request() {
        let mut request = valid_request();
        request.attachments.push(AiAttachmentInput {
            name: "reference.jpg".into(),
            src: "data:image/jpeg;base64,YQ==".into(),
            intent: "reference".into(),
            bytes: 1,
        });

        let body = create_openai_request(
            &request,
            &test_chat_provider("https://example.com/v1".into()),
        )
        .unwrap();
        let serialized = body.to_string();

        assert_eq!(body["model"], "provider-model");
        assert_eq!(body["max_tokens"], MAX_OUTPUT_TOKENS);
        assert_eq!(body["messages"][0]["role"], "system");
        assert_eq!(
            body["messages"][1]["content"][1]["image_url"]["detail"],
            "high"
        );
        assert!(body.get("store").is_none());
        assert!(body.get("response_format").is_none());
        assert!(!serialized.contains("API Key"));
    }

    #[test]
    fn normalizes_compatible_endpoints_and_rejects_unsafe_http() {
        let openai = normalize_ai_endpoint(&AiProviderConfig {
            base_url: "https://api.openai.com/v1/".into(),
            model: "gpt-5.6-sol".into(),
            api_format: AiApiFormat::Responses,
        })
        .unwrap();
        assert_eq!(openai.as_str(), "https://api.openai.com/v1/responses");

        let local = normalize_ai_endpoint(&AiProviderConfig {
            base_url: "http://127.0.0.1:11434/v1".into(),
            model: "local-model".into(),
            api_format: AiApiFormat::ChatCompletions,
        })
        .unwrap();
        assert_eq!(local.as_str(), "http://127.0.0.1:11434/v1/chat/completions");

        let switched = normalize_ai_endpoint(&AiProviderConfig {
            base_url: "https://gateway.example.com/v1/responses".into(),
            model: "provider-model".into(),
            api_format: AiApiFormat::ChatCompletions,
        })
        .unwrap();
        assert_eq!(
            switched.as_str(),
            "https://gateway.example.com/v1/chat/completions"
        );

        let insecure = normalize_ai_endpoint(&AiProviderConfig {
            base_url: "http://gateway.example.com/v1".into(),
            model: "provider-model".into(),
            api_format: AiApiFormat::Responses,
        })
        .unwrap_err();
        assert!(insecure.contains("HTTPS"));

        let unsafe_query = normalize_ai_endpoint(&AiProviderConfig {
            base_url: "https://gateway.example.com/v1?token=secret".into(),
            model: "provider-model".into(),
            api_format: AiApiFormat::Responses,
        })
        .unwrap_err();
        assert!(unsafe_query.contains("查询参数"));
    }

    #[tokio::test]
    async fn maps_authentication_failures_without_leaking_the_key() {
        for (status, expected) in [(401, "未被接口接受"), (403, "没有所选接口")] {
            let endpoint = mock_endpoint(status, "{}".into(), Duration::ZERO).await;
            let provider = test_provider(endpoint);
            let error = generate_page_design_at(
                valid_request(),
                "secret-key-must-not-appear",
                &provider,
                Duration::from_secs(1),
            )
            .await
            .unwrap_err();
            assert!(error.contains("API Key"));
            assert!(error.contains(expected));
            assert!(!error.contains("secret-key-must-not-appear"));
        }
    }

    #[tokio::test]
    async fn maps_rate_limit_and_server_failures() {
        let rate_limit = mock_endpoint(429, "{}".into(), Duration::ZERO).await;
        let rate_provider = test_provider(rate_limit);
        let rate_error = generate_page_design_at(
            valid_request(),
            "test-key",
            &rate_provider,
            Duration::from_secs(1),
        )
        .await
        .unwrap_err();
        assert!(rate_error.contains("频繁"));

        let gateway_error = mock_endpoint(502, "{}".into(), Duration::ZERO).await;
        let gateway_provider = test_provider(gateway_error);
        let error = generate_page_design_at(
            valid_request(),
            "test-key",
            &gateway_provider,
            Duration::from_secs(1),
        )
        .await
        .unwrap_err();
        assert!(error.contains("中转站"));

        let server_error = mock_endpoint(503, "{}".into(), Duration::ZERO).await;
        let server_provider = test_provider(server_error);
        let error = generate_page_design_at(
            valid_request(),
            "test-key",
            &server_provider,
            Duration::from_secs(1),
        )
        .await
        .unwrap_err();
        assert!(error.contains("503"));
    }

    #[tokio::test]
    async fn maps_timeouts() {
        let endpoint = mock_endpoint(200, "{}".into(), Duration::from_millis(100)).await;
        let provider = test_provider(endpoint);
        let error = generate_page_design_at(
            valid_request(),
            "test-key",
            &provider,
            Duration::from_millis(10),
        )
        .await
        .unwrap_err();
        assert!(error.contains("超时"));
    }

    #[tokio::test]
    async fn rejects_refusals_and_malformed_outputs() {
        let refusal = json!({
            "status": "completed",
            "output": [{
                "type": "message",
                "content": [{ "type": "refusal", "refusal": "no" }]
            }]
        })
        .to_string();
        let refusal_endpoint = mock_endpoint(200, refusal, Duration::ZERO).await;
        let refusal_provider = test_provider(refusal_endpoint);
        let refusal_error = generate_page_design_at(
            valid_request(),
            "test-key",
            &refusal_provider,
            Duration::from_secs(1),
        )
        .await
        .unwrap_err();
        assert!(refusal_error.contains("拒绝"));

        let malformed = json!({
            "status": "completed",
            "output": [{
                "type": "message",
                "content": [{ "type": "output_text", "text": "not-json" }]
            }]
        })
        .to_string();
        let malformed_endpoint = mock_endpoint(200, malformed, Duration::ZERO).await;
        let malformed_provider = test_provider(malformed_endpoint);
        let malformed_error = generate_page_design_at(
            valid_request(),
            "test-key",
            &malformed_provider,
            Duration::from_secs(1),
        )
        .await
        .unwrap_err();
        assert!(malformed_error.contains("格式异常"));
    }

    fn valid_request() -> GeneratePageDesignRequest {
        GeneratePageDesignRequest {
            prompt: "使用更有节奏的章节设计".into(),
            profile: AiProfileSnapshot {
                name: "林予安".into(),
                headline: "产品设计师".into(),
                bio: "简介".into(),
                email: "hello@example.com".into(),
                location: "上海".into(),
                accent_color: "#0f766e".into(),
                has_avatar: false,
                skills: vec!["产品设计".into()],
                projects: vec![AiProjectSnapshot {
                    title: "项目".into(),
                    description: "项目简介".into(),
                    tags: vec!["设计".into()],
                    has_image: false,
                }],
                socials: vec![AiSocialSnapshot {
                    label: "个人网站".into(),
                    url: "https://example.com".into(),
                }],
            },
            attachments: Vec::<AiAttachmentInput>::new(),
        }
    }

    fn valid_design() -> serde_json::Value {
        json!({
            "version": 1,
            "bodyHtml": "<main><h1 data-slot=\"name\"></h1><p data-slot=\"headline\"></p><p data-slot=\"bio\"></p><div data-slot=\"skills\"></div><div data-slot=\"projects\"></div><div data-slot=\"contact\"></div></main>",
            "css": "body{margin:0}",
            "effects": [],
            "createdAt": "2026-07-30T00:00:00Z"
        })
    }

    fn test_provider(base_url: String) -> AiProviderConfig {
        AiProviderConfig {
            base_url,
            model: "provider-model".into(),
            api_format: AiApiFormat::Responses,
        }
    }

    fn test_chat_provider(base_url: String) -> AiProviderConfig {
        AiProviderConfig {
            base_url,
            model: "provider-model".into(),
            api_format: AiApiFormat::ChatCompletions,
        }
    }

    async fn mock_endpoint(status: u16, body: String, delay: Duration) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0u8; 16_384];
            let _ = socket.read(&mut request).await;
            if !delay.is_zero() {
                sleep(delay).await;
            }
            let reason = if status >= 500 { "Server Error" } else { "OK" };
            let response = format!(
                "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = socket.write_all(response.as_bytes()).await;
        });
        format!("http://{address}/v1/responses")
    }
}
