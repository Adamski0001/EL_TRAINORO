import { BlurView } from 'expo-blur';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

const WELCOME_TEXT = 'Welcome to TRAINAR!';
const LETTER_INTERVAL_MS = 90;
const INTRO_HOLD_DURATION_MS = 5000;
const BLUR_DURATION_MS = 700;
const WHITEOUT_DURATION_MS = 1500;

const QUESTIONS = [
  { key: 'name', label: "What's your name?", placeholder: 'Name' },
  {
    key: 'interest',
    label: 'Why are you interested in TRAINAR?',
    placeholder: 'Share a sentence or two',
  },
  {
    key: 'travelHabits',
    label: 'How do you use trains or transit right now?',
    placeholder: 'Daily commute, weekend trips, etc.',
  },
] as const;

type Stage =
  | 'typing'
  | 'hold'
  | 'blur'
  | 'whiteout'
  | 'options'
  | 'createAccount'
  | 'login'
  | 'questions';
type StageView = 'welcome' | 'whiteout' | 'options' | 'createAccount' | 'login' | 'questions';
type QuestionKey = (typeof QUESTIONS)[number]['key'];

export type OnboardingAnswers = Record<QuestionKey, string>;

type Props = {
  onComplete: (answers?: OnboardingAnswers) => void;
};

export const OnboardingOverlay = ({ onComplete }: Props) => {
  const [stage, setStage] = useState<Stage>('typing');
  const [answers, setAnswers] = useState<OnboardingAnswers>(() =>
    QUESTIONS.reduce(
      (acc, question) => ({
        ...acc,
        [question.key]: '',
      }),
      {} as OnboardingAnswers,
    ),
  );
  const [typedText, setTypedText] = useState('');
  const welcomeOpacity = useRef(new Animated.Value(1)).current;
  const overlayOpacity = useRef(new Animated.Value(1)).current;
  const stageOpacity = useRef(new Animated.Value(1)).current;
  const hasCompletedRef = useRef(false);
  const [accountForm, setAccountForm] = useState({ name: '', email: '', password: '' });
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [forgotPasswordNotice, setForgotPasswordNotice] = useState<string | null>(null);
  const stageView = useMemo<StageView>(() => {
    if (stage === 'typing' || stage === 'hold' || stage === 'blur') {
      return 'welcome';
    }
    if (stage === 'whiteout') {
      return 'whiteout';
    }
    return stage;
  }, [stage]);
  const [displayStageView, setDisplayStageView] = useState<StageView>(stageView);
  const stageAnimatedStyle = {
    opacity: stageOpacity,
    transform: [
      {
        translateY: stageOpacity.interpolate({
          inputRange: [0, 1],
          outputRange: [20, 0],
        }),
      },
    ],
  };

  useEffect(() => {
    if (stage !== 'typing') {
      return;
    }
    setTypedText('');
    let index = 0;
    const interval = setInterval(() => {
      index += 1;
      setTypedText(WELCOME_TEXT.slice(0, index));
      if (index === WELCOME_TEXT.length) {
        clearInterval(interval);
        setStage('hold');
      }
    }, LETTER_INTERVAL_MS);
    return () => {
      clearInterval(interval);
    };
  }, [stage]);

  useEffect(() => {
    if (stage !== 'hold') {
      return;
    }
    const timer = setTimeout(() => setStage('blur'), INTRO_HOLD_DURATION_MS);
    return () => clearTimeout(timer);
  }, [stage]);

  useEffect(() => {
    if (stage !== 'blur') {
      return;
    }
    welcomeOpacity.setValue(1);
    Animated.timing(welcomeOpacity, {
      toValue: 0,
      duration: BLUR_DURATION_MS,
      useNativeDriver: true,
    }).start();
    const timer = setTimeout(() => setStage('whiteout'), BLUR_DURATION_MS);
    return () => clearTimeout(timer);
  }, [stage, welcomeOpacity]);

  useEffect(() => {
    if (stage !== 'whiteout') {
      return;
    }
    const timer = setTimeout(() => setStage('options'), WHITEOUT_DURATION_MS);
    return () => clearTimeout(timer);
  }, [stage]);

  useEffect(() => {
    if (stageView === displayStageView) {
      return;
    }
    Animated.timing(stageOpacity, {
      toValue: 0,
      duration: 220,
      useNativeDriver: true,
    }).start(() => {
      setDisplayStageView(stageView);
      stageOpacity.setValue(0);
      Animated.timing(stageOpacity, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }).start();
    });
  }, [stageView, displayStageView, stageOpacity]);

  const answeredAll = useMemo(
    () => QUESTIONS.every(question => answers[question.key].trim().length > 0),
    [answers],
  );

  const handleAnswerChange = (key: QuestionKey, value: string) => {
    setAnswers(prev => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleCompleteWithAnswers = () => {
    if (!answeredAll) {
      return;
    }
    completeWithFade(answers);
  };

  const completeWithFade = (nextAnswers?: OnboardingAnswers) => {
    if (hasCompletedRef.current) {
      return;
    }
    hasCompletedRef.current = true;
    Animated.timing(overlayOpacity, {
      toValue: 0,
      duration: 420,
      useNativeDriver: true,
    }).start(() => {
      onComplete(nextAnswers);
    });
  };

  const handleGoToQuestions = () => {
    setAnswers(prev => ({
      ...prev,
      name: prev.name || accountForm.name,
    }));
    setStage('questions');
  };

  const handleForgotPassword = () => {
    if (!loginForm.email.trim()) {
      setForgotPasswordNotice('Enter your email to reset your password.');
      return;
    }
    setForgotPasswordNotice(`Password reset link sent to ${loginForm.email.trim()}.`);
  };

  const handleLogin = () => {
    if (!loginForm.email.trim() || !loginForm.password.trim()) {
      return;
    }
    completeWithFade();
  };

  const accountFormReady =
    accountForm.name.trim().length > 0 &&
    accountForm.email.trim().length > 0 &&
    accountForm.password.trim().length >= 6;
  const loginFormReady =
    loginForm.email.trim().length > 0 && loginForm.password.trim().length > 0;
  const isFormStage =
    displayStageView === 'createAccount' ||
    displayStageView === 'login' ||
    displayStageView === 'questions';

  const renderContent = () => {
    if (displayStageView === 'welcome') {
      return (
        <View style={styles.centeredBlock}>
          <Animated.Text style={[styles.welcome, { opacity: welcomeOpacity }]}>
            {typedText}
          </Animated.Text>
          {stage === 'blur' ? (
            <BlurView pointerEvents="none" intensity={60} tint="light" style={StyleSheet.absoluteFill} />
          ) : null}
        </View>
      );
    }
    if (displayStageView === 'whiteout') {
      return <View style={styles.whiteout} />;
    }
    if (displayStageView === 'options') {
      return (
        <View style={styles.centeredBlock}>
          <Text style={styles.optionHeading}>Welcome to TRAINAR</Text>
          <Text style={styles.optionBody}>
            Pick how you would like to get started so we can personalise your experience.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
            onPress={() => setStage('createAccount')}
          >
            <Text style={styles.primaryButtonLabel}>Create Account</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.secondaryButtonPressed]}
            onPress={() => setStage('login')}
          >
            <Text style={styles.secondaryButtonLabel}>Log In</Text>
          </Pressable>
        </View>
      );
    }
    if (displayStageView === 'createAccount') {
      return (
        <KeyboardAvoidingView
          behavior={Platform.select({ ios: 'padding', android: undefined })}
          style={styles.formWrapper}
        >
          <ScrollView
            contentContainerStyle={styles.formContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.formHeading}>Create your account</Text>
            <Text style={styles.formSubheading}>
              We will use this to personalise TRAINAR for you.
            </Text>
            <View style={styles.questionBlock}>
              <Text style={styles.questionLabel}>Name</Text>
              <TextInput
                style={styles.input}
                value={accountForm.name}
                onChangeText={value => setAccountForm(prev => ({ ...prev, name: value }))}
                placeholder="Full name"
                placeholderTextColor="#B0B0B0"
                autoCapitalize="words"
              />
            </View>
            <View style={styles.questionBlock}>
              <Text style={styles.questionLabel}>Email</Text>
              <TextInput
                style={styles.input}
                value={accountForm.email}
                onChangeText={value => setAccountForm(prev => ({ ...prev, email: value }))}
                placeholder="email@domain.com"
                placeholderTextColor="#B0B0B0"
                autoCapitalize="none"
                keyboardType="email-address"
              />
            </View>
            <View style={styles.questionBlock}>
              <Text style={styles.questionLabel}>Password</Text>
              <TextInput
                style={styles.input}
                value={accountForm.password}
                onChangeText={value => setAccountForm(prev => ({ ...prev, password: value }))}
                placeholder="Minimum 6 characters"
                placeholderTextColor="#B0B0B0"
                secureTextEntry
              />
            </View>
            <Pressable
              disabled={!accountFormReady}
              style={({ pressed }) => [
                styles.primaryButton,
                styles.questionsButton,
                !accountFormReady && styles.disabledButton,
                pressed && accountFormReady && styles.primaryButtonPressed,
              ]}
              onPress={handleGoToQuestions}
            >
              <Text style={[styles.primaryButtonLabel, !accountFormReady && styles.disabledButtonLabel]}>
                Continue
              </Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      );
    }
    if (displayStageView === 'login') {
      return (
        <KeyboardAvoidingView
          behavior={Platform.select({ ios: 'padding', android: undefined })}
          style={styles.formWrapper}
        >
          <ScrollView
            contentContainerStyle={styles.formContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.formHeading}>Log in to TRAINAR</Text>
            <Text style={styles.formSubheading}>Welcome back. Let's pick up where you left off.</Text>
            <View style={styles.questionBlock}>
              <Text style={styles.questionLabel}>Email</Text>
              <TextInput
                style={styles.input}
                value={loginForm.email}
                onChangeText={value => {
                  setForgotPasswordNotice(null);
                  setLoginForm(prev => ({ ...prev, email: value }));
                }}
                placeholder="email@domain.com"
                placeholderTextColor="#B0B0B0"
                autoCapitalize="none"
                keyboardType="email-address"
              />
            </View>
            <View style={styles.questionBlock}>
              <Text style={styles.questionLabel}>Password</Text>
              <TextInput
                style={styles.input}
                value={loginForm.password}
                onChangeText={value => {
                  setForgotPasswordNotice(null);
                  setLoginForm(prev => ({ ...prev, password: value }));
                }}
                placeholder="••••••••"
                placeholderTextColor="#B0B0B0"
                secureTextEntry
              />
            </View>
            <Pressable style={styles.forgotButton} onPress={handleForgotPassword}>
              <Text style={styles.forgotButtonLabel}>Forgot password?</Text>
            </Pressable>
            {forgotPasswordNotice ? (
              <Text style={styles.notice}>{forgotPasswordNotice}</Text>
            ) : null}
            <Pressable
              disabled={!loginFormReady}
              style={({ pressed }) => [
                styles.primaryButton,
                styles.questionsButton,
                !loginFormReady && styles.disabledButton,
                pressed && loginFormReady && styles.primaryButtonPressed,
              ]}
              onPress={handleLogin}
            >
              <Text style={[styles.primaryButtonLabel, !loginFormReady && styles.disabledButtonLabel]}>
                Log In
              </Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      );
    }
    return (
      <KeyboardAvoidingView
        behavior={Platform.select({ ios: 'padding', android: undefined })}
        style={styles.questionsWrapper}
      >
        <ScrollView
          contentContainerStyle={styles.questionsContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.questionsHeading}>Tell us a bit about you</Text>
          <Text style={styles.questionsSubheading}>
            These answers help the AI understand you whenever you ask for guidance inside TRAINAR.
          </Text>
          {QUESTIONS.map(question => (
            <View key={question.key} style={styles.questionBlock}>
              <Text style={styles.questionLabel}>{question.label}</Text>
              <TextInput
                style={styles.input}
                placeholder={question.placeholder}
                placeholderTextColor="#B0B0B0"
                value={answers[question.key]}
                onChangeText={value => handleAnswerChange(question.key, value)}
                multiline={question.key !== 'name'}
                autoCorrect
                autoCapitalize={question.key === 'name' ? 'words' : 'sentences'}
              />
            </View>
          ))}
          <Pressable
            disabled={!answeredAll}
            style={({ pressed }) => [
              styles.primaryButton,
              styles.questionsButton,
              !answeredAll && styles.disabledButton,
              pressed && answeredAll && styles.primaryButtonPressed,
            ]}
            onPress={handleCompleteWithAnswers}
          >
            <Text style={[styles.primaryButtonLabel, !answeredAll && styles.disabledButtonLabel]}>
              Save & Continue
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  };

  const contentStyles = [styles.content, stageAnimatedStyle];
  if (displayStageView === 'whiteout') {
    contentStyles.push(styles.contentWhiteout);
  } else if (isFormStage) {
    contentStyles.push(styles.contentForm);
  } else {
    contentStyles.push(styles.contentCentered);
  }

  return (
    <Animated.View pointerEvents="auto" style={[styles.overlay, { opacity: overlayOpacity }]}>
      <Animated.View style={contentStyles}>{renderContent()}</Animated.View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#fff',
  },
  content: {
    flex: 1,
    width: '100%',
  },
  contentCentered: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  contentForm: {
    justifyContent: 'flex-start',
    paddingTop: 80,
  },
  contentWhiteout: {
    paddingHorizontal: 0,
  },
  centeredBlock: {
    width: '100%',
    alignItems: 'center',
  },
  welcome: {
    fontSize: 28,
    letterSpacing: 0.5,
    fontWeight: '600',
    color: '#050505',
    textAlign: 'center',
  },
  whiteout: {
    flex: 1,
    alignSelf: 'stretch',
    backgroundColor: '#fff',
  },
  optionHeading: {
    fontSize: 26,
    fontWeight: '600',
    color: '#050505',
    marginBottom: 12,
    textAlign: 'center',
  },
  optionBody: {
    fontSize: 16,
    color: '#3a3a3a',
    marginBottom: 28,
    textAlign: 'center',
  },
  primaryButton: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 999,
    backgroundColor: '#050505',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonPressed: {
    opacity: 0.9,
  },
  primaryButtonLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#050505',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  secondaryButtonPressed: {
    opacity: 0.8,
  },
  secondaryButtonLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: '#050505',
  },
  formWrapper: {
    flex: 1,
    width: '100%',
    paddingHorizontal: 32,
  },
  formContent: {
    paddingTop: 12,
    paddingBottom: 40,
  },
  formHeading: {
    fontSize: 24,
    fontWeight: '600',
    color: '#050505',
    marginBottom: 6,
  },
  formSubheading: {
    fontSize: 15,
    color: '#3a3a3a',
    marginBottom: 20,
  },
  questionsWrapper: {
    flex: 1,
    width: '100%',
    paddingHorizontal: 32,
  },
  questionsContent: {
    paddingTop: 60,
    paddingBottom: 40,
  },
  questionsHeading: {
    fontSize: 24,
    textAlign: 'center',
    fontWeight: '600',
    color: '#050505',
    marginBottom: 8,
  },
  questionsSubheading: {
    fontSize: 15,
    textAlign: 'center',
    color: '#3a3a3a',
    paddingHorizontal: 12,
    marginBottom: 24,
  },
  questionBlock: {
    width: '100%',
    marginBottom: 24,
  },
  questionLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: '#050505',
    marginBottom: 8,
  },
  input: {
    minHeight: 60,
    width: '100%',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E1E1E1',
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: '#050505',
    backgroundColor: '#fff',
  },
  questionsButton: {
    marginTop: 12,
    alignSelf: 'center',
  },
  forgotButton: {
    alignSelf: 'flex-start',
    marginTop: -4,
  },
  forgotButtonLabel: {
    fontSize: 14,
    color: '#050505',
    textDecorationLine: 'underline',
  },
  notice: {
    fontSize: 13,
    color: '#3a3a3a',
    marginTop: 8,
  },
  disabledButton: {
    backgroundColor: '#C8C8C8',
  },
  disabledButtonLabel: {
    color: '#FAFAFA',
  },
});
