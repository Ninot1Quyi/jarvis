//! Parity harness scaffolding tests

use chrono::{Duration, TimeZone, Utc};
use dum_e::harness::{
    build_parity_report, canonical_parity_corpus, compare_sequence_summaries, replay_frames,
    summarize_event_sequence, SequenceSummaryEntry,
};
use dum_e::observability::{Component, Event, EventData, EventType, SpanId, TraceId};

fn test_event(
    timestamp: chrono::DateTime<Utc>,
    component: Component,
    event_type: EventType,
    data: EventData,
) -> Event {
    Event {
        trace_id: TraceId::from_str("trace-1"),
        span_id: SpanId::from_str("span-1"),
        parent_span_id: None,
        timestamp,
        component,
        event_type,
        duration_ms: None,
        data,
    }
}

#[test]
fn canonical_parity_corpus_matches_spec_shape() {
    let corpus = canonical_parity_corpus();
    assert_eq!(corpus.len(), 10);
    assert!(corpus
        .iter()
        .any(|scenario| scenario.id == "pure_text_stream"));
    assert!(corpus
        .iter()
        .any(|scenario| scenario.id == "replay_reconstruction"));
}

#[test]
fn summarize_event_sequence_compresses_adjacent_duplicates() {
    let base = Utc.with_ymd_and_hms(2026, 4, 12, 8, 0, 0).unwrap();
    let events = vec![
        test_event(
            base,
            Component::Agent,
            EventType::AgentStart,
            EventData::Message {
                message: "start".to_string(),
            },
        ),
        test_event(
            base + Duration::milliseconds(1),
            Component::Llm,
            EventType::LlmChunk,
            EventData::LlmChunk {
                text: "a".to_string(),
            },
        ),
        test_event(
            base + Duration::milliseconds(2),
            Component::Llm,
            EventType::LlmChunk,
            EventData::LlmChunk {
                text: "b".to_string(),
            },
        ),
        test_event(
            base + Duration::milliseconds(3),
            Component::Tool,
            EventType::ToolComplete,
            EventData::Message {
                message: "done".to_string(),
            },
        ),
    ];

    let summary = summarize_event_sequence(&events);
    assert_eq!(
        summary,
        vec![
            SequenceSummaryEntry::new("agent_start", 1),
            SequenceSummaryEntry::new("llm_chunk", 2),
            SequenceSummaryEntry::new("tool_complete", 1),
        ]
    );
}

#[test]
fn replay_frames_are_sorted_and_preserve_detail() {
    let base = Utc.with_ymd_and_hms(2026, 4, 12, 8, 0, 0).unwrap();
    let later = test_event(
        base + Duration::milliseconds(10),
        Component::Tool,
        EventType::ToolComplete,
        EventData::ToolProgress {
            tool: "bash".to_string(),
            output: "ok".to_string(),
        },
    );
    let earlier = test_event(
        base,
        Component::Agent,
        EventType::AgentStart,
        EventData::Message {
            message: "task".to_string(),
        },
    );

    let frames = replay_frames(&[later, earlier]);
    assert_eq!(frames.len(), 2);
    assert_eq!(frames[0].event_type, "agent_start");
    assert_eq!(frames[0].detail, "task");
    assert_eq!(frames[1].event_type, "tool_complete");
    assert_eq!(frames[1].detail, "bash ok");
}

#[test]
fn parity_report_flags_first_mismatch_location() {
    let base = Utc.with_ymd_and_hms(2026, 4, 12, 8, 0, 0).unwrap();
    let events = vec![
        test_event(
            base,
            Component::Agent,
            EventType::AgentStart,
            EventData::Message {
                message: "start".to_string(),
            },
        ),
        test_event(
            base + Duration::milliseconds(1),
            Component::Llm,
            EventType::LlmStart,
            EventData::Empty,
        ),
        test_event(
            base + Duration::milliseconds(2),
            Component::Agent,
            EventType::AgentComplete,
            EventData::Message {
                message: "done".to_string(),
            },
        ),
    ];

    let expected = vec![
        SequenceSummaryEntry::new("agent_start", 1),
        SequenceSummaryEntry::new("llm_chunk", 1),
        SequenceSummaryEntry::new("agent_complete", 1),
    ];

    let comparison = compare_sequence_summaries(&summarize_event_sequence(&events), &expected);
    assert!(!comparison.passed);
    assert_eq!(comparison.first_mismatch_index, Some(1));

    let report = build_parity_report("scenario-1", &events, &expected);
    assert_eq!(report.diff_verdict, "FAIL");
    assert_eq!(report.first_mismatch_location, Some(1));
    let rendered = report.to_string();
    assert!(rendered.contains("scenario id: scenario-1"));
    assert!(rendered.contains("diff verdict: FAIL"));
    assert!(rendered.contains("first mismatch location: 1"));
}
