import { FormEvent, useState } from 'react';
import { gql, useMutation } from '@apollo/client';

const SIGN_IN = gql`
  mutation SignIn($email: String!, $password: String!) {
    signIn(email: $email, password: $password) { token }
  }
`;
const SIGN_UP = gql`
  mutation SignUp($email: String!, $password: String!) {
    signUp(email: $email, password: $password) { token }
  }
`;

export default function LoginForm({ onSuccess }: { onSuccess: (token: string) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [error, setError] = useState<string | null>(null);
  const [signIn, { loading: signinLoading }] = useMutation<{ signIn: { token: string } }, { email: string; password: string }>(SIGN_IN);
  const [signUp, { loading: signupLoading }] = useMutation<{ signUp: { token: string } }, { email: string; password: string }>(SIGN_UP);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (mode === 'signin') {
        const res = await signIn({ variables: { email, password } });
        const token = res.data?.signIn.token;
        if (token) onSuccess(token);
      } else {
        const res = await signUp({ variables: { email, password } });
        const token = res.data?.signUp.token;
        if (token) onSuccess(token);
      }
    } catch (err: any) {
      setError(err.message || 'Login failed');
    }
  };

  const loading = signinLoading || signupLoading;

  return (
    <form onSubmit={onSubmit} className="ios-card-elevated p-8 space-y-6">
      <div className="ios-segment w-full">
        <button type="button" onClick={() => setMode('signin')} className={`ios-segment-button flex-1 ${mode==='signin' ? 'ios-segment-button-active' : ''}`}>Sign In</button>
        <button type="button" onClick={() => setMode('signup')} className={`ios-segment-button flex-1 ${mode==='signup' ? 'ios-segment-button-active' : ''}`}>Sign Up</button>
      </div>
      <div>
        <label className="block text-sm font-semibold mb-2 text-gray-700">Email</label>
        <input type="email" value={email} onChange={(e)=>setEmail(e.target.value)} required className="ios-input" placeholder="you@example.com" />
      </div>
      <div>
        <label className="block text-sm font-semibold mb-2 text-gray-700">Password</label>
        <input type="password" value={password} onChange={(e)=>setPassword(e.target.value)} required className="ios-input" placeholder="••••••••" />
      </div>
      {error && (
        <div className="ios-badge-error inline-flex items-center gap-2 p-3 rounded-xl w-full">
          <span className="text-sm font-medium">{error}</span>
        </div>
      )}
      <button type="submit" disabled={loading} className="w-full ios-button-primary">
        {loading ? 'Please wait…' : (mode === 'signin' ? 'Sign In' : 'Sign Up')}
      </button>
    </form>
  );
}
