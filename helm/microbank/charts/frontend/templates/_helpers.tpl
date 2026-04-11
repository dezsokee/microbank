{{- define "frontend.fullname" -}}
{{- printf "%s-frontend" .Release.Name -}}
{{- end -}}

{{- define "frontend.labels" -}}
app.kubernetes.io/name: frontend
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/part-of: microbank
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "frontend.selectorLabels" -}}
app.kubernetes.io/name: frontend
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
