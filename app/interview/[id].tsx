import { useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { generateInterviewQuestions } from '@/src/services/interviewService';
import type { InterviewQuestion, InterviewQuestionType } from '@/src/types/interview';

const QUESTION_TYPE_LABELS: Record<InterviewQuestionType, string> = {
  behavioral: '行为类',
  technical: '技术类',
  role_specific: '岗位相关',
  general: '通用',
};

export default function InterviewSessionScreen() {
  const params = useLocalSearchParams<{
    id?: string | string[];
    jobTitle?: string | string[];
    companyName?: string | string[];
  }>();

  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const id = (rawId ?? '').trim();
  const jobTitle = Array.isArray(params.jobTitle) ? params.jobTitle[0] : params.jobTitle;
  const companyName = Array.isArray(params.companyName)
    ? params.companyName[0]
    : params.companyName;

  const [questions, setQuestions] = useState<InterviewQuestion[] | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const generatingRef = useRef(false);

  const handleGenerate = async () => {
    if (generatingRef.current || id.length === 0) {
      return;
    }

    generatingRef.current = true;
    setIsGenerating(true);
    setErrorMessage(null);

    try {
      const result = await generateInterviewQuestions(id);
      setQuestions(result.questions);
    } catch {
      setErrorMessage('生成失败，请稍后重试。');
    } finally {
      setIsGenerating(false);
      generatingRef.current = false;
    }
  };

  if (id.length === 0) {
    return (
      <View style={styles.invalidContainer}>
        <Text style={styles.invalidText}>面试记录无效</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {(jobTitle || companyName) && (
        <Text style={styles.subtitle}>
          {companyName} · {jobTitle}
        </Text>
      )}

      {questions === null ? (
        <View style={styles.introCard}>
          <Text style={styles.introText}>
            AI 将根据你上传的 CV 和岗位信息生成 10 道面试问题。
          </Text>
          <Text style={styles.consentText}>
            点击生成即表示你同意本次将 CV 和岗位信息用于 AI 处理。
          </Text>

          {errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}

          <Pressable
            onPress={handleGenerate}
            disabled={isGenerating}
            accessibilityRole="button"
            accessibilityLabel="生成面试问题"
            style={[styles.generateButton, isGenerating && styles.generateButtonDisabled]}>
            {isGenerating ? (
              <View style={styles.generateButtonRow}>
                <ActivityIndicator color="#fff" />
                <Text style={styles.generateButtonText}>正在生成面试问题…</Text>
              </View>
            ) : (
              <Text style={styles.generateButtonText}>生成面试问题</Text>
            )}
          </Pressable>
        </View>
      ) : (
        <View style={styles.questionsList}>
          {questions.map((question, index) => (
            <View key={question.id} style={styles.questionCard}>
              <View style={styles.questionHeaderRow}>
                <Text style={styles.questionIndex}>问题 {index + 1}</Text>
                <Text style={styles.questionTypeLabel}>
                  {QUESTION_TYPE_LABELS[question.questionType]}
                </Text>
              </View>
              <Text style={styles.questionText}>{question.questionText}</Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  invalidContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F2F2F7',
    padding: 20,
  },
  invalidText: {
    fontSize: 15,
    color: '#8e8e93',
  },
  container: {
    flexGrow: 1,
    backgroundColor: '#F2F2F7',
    padding: 16,
    paddingTop: 14,
    gap: 12,
  },
  subtitle: {
    fontSize: 13,
    color: '#8e8e93',
  },
  introCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    gap: 10,
  },
  introText: {
    fontSize: 17,
    lineHeight: 24,
    color: '#000',
  },
  consentText: {
    fontSize: 12,
    color: '#8e8e93',
  },
  errorText: {
    fontSize: 13,
    color: '#d9534f',
  },
  generateButton: {
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: '#2f95dc',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  generateButtonDisabled: {
    opacity: 0.5,
  },
  generateButtonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  generateButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  questionsList: {
    gap: 12,
  },
  questionCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  questionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  questionIndex: {
    fontSize: 13,
    fontWeight: '600',
    color: '#3c3c43',
  },
  questionTypeLabel: {
    fontSize: 12,
    color: '#8e8e93',
  },
  questionText: {
    fontSize: 17,
    lineHeight: 24,
    color: '#000',
  },
});
