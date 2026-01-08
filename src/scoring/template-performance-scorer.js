/**
 * Email Template Performance Scoring System
 * 
 * Scores email templates based on multiple performance metrics:
 * - Open Rate (weight: 25%)
 * - Response Rate (weight: 35%) 
 * - Collection Success Rate (weight: 30%)
 * - Time to Payment (weight: 10%)
 */

class TemplatePerformanceScorer {
  constructor() {
    // Metric weights (must sum to 1.0)
    this.weights = {
      openRate: 0.25,
      responseRate: 0.35,
      collectionSuccess: 0.30,
      timeToPayment: 0.10
    };

    // Performance benchmarks for normalization
    this.benchmarks = {
      openRate: { min: 0.05, max: 0.40, target: 0.25 },
      responseRate: { min: 0.02, max: 0.25, target: 0.15 },
      collectionSuccess: { min: 0.01, max: 0.50, target: 0.30 },
      timeToPayment: { min: 1, max: 30, target: 7 } // days
    };
  }

  /**
   * Calculate composite performance score for a template
   * @param {Object} metrics - Template performance metrics
   * @returns {Object} Scoring results
   */
  calculateScore(metrics) {
    try {
      const normalizedScores = this.normalizeMetrics(metrics);
      const weightedScore = this.calculateWeightedScore(normalizedScores);
      const grade = this.assignGrade(weightedScore);
      
      return {
        templateId: metrics.templateId,
        compositeScore: Math.round(weightedScore * 100) / 100,
        grade: grade,
        normalizedScores: normalizedScores,
        rawMetrics: metrics,
        strengths: this.identifyStrengths(normalizedScores),
        weaknesses: this.identifyWeaknesses(normalizedScores),
        recommendations: this.generateRecommendations(normalizedScores)
      };
    } catch (error) {
      console.error(`Error calculating score for template ${metrics.templateId}:`, error);
      return this.createErrorScore(metrics.templateId);
    }
  }

  /**
   * Normalize metrics to 0-1 scale based on benchmarks
   * @param {Object} metrics - Raw performance metrics
   * @returns {Object} Normalized scores
   */
  normalizeMetrics(metrics) {
    const normalized = {};
    
    // Open rate normalization (higher is better)
    normalized.openRate = this.normalizePositive(
      metrics.openRate, 
      this.benchmarks.openRate
    );
    
    // Response rate normalization (higher is better)
    normalized.responseRate = this.normalizePositive(
      metrics.responseRate, 
      this.benchmarks.responseRate
    );
    
    // Collection success normalization (higher is better)
    normalized.collectionSuccess = this.normalizePositive(
      metrics.collectionSuccessRate, 
      this.benchmarks.collectionSuccess
    );
    
    // Time to payment normalization (lower is better)
    normalized.timeToPayment = this.normalizeNegative(
      metrics.averageTimeToPayment, 
      this.benchmarks.timeToPayment
    );
    
    return normalized;
  }

  /**
   * Normalize metric where higher values are better
   */
  normalizePositive(value, benchmark) {
    if (value <= benchmark.min) return 0;
    if (value >= benchmark.max) return 1;
    return (value - benchmark.min) / (benchmark.max - benchmark.min);
  }

  /**
   * Normalize metric where lower values are better (like time to payment)
   */
  normalizeNegative(value, benchmark) {
    if (value >= benchmark.max) return 0;
    if (value <= benchmark.min) return 1;
    return 1 - ((value - benchmark.min) / (benchmark.max - benchmark.min));
  }

  /**
   * Calculate weighted composite score
   */
  calculateWeightedScore(normalizedScores) {
    return (
      normalizedScores.openRate * this.weights.openRate +
      normalizedScores.responseRate * this.weights.responseRate +
      normalizedScores.collectionSuccess * this.weights.collectionSuccess +
      normalizedScores.timeToPayment * this.weights.timeToPayment
    );
  }

  /**
   * Assign letter grade based on composite score
   */
  assignGrade(score) {
    if (score >= 0.90) return 'A+';
    if (score >= 0.85) return 'A';
    if (score >= 0.80) return 'A-';
    if (score >= 0.75) return 'B+';
    if (score >= 0.70) return 'B';
    if (score >= 0.65) return 'B-';
    if (score >= 0.60) return 'C+';
    if (score >= 0.55) return 'C';
    if (score >= 0.50) return 'C-';
    if (score >= 0.40) return 'D';
    return 'F';
  }

  /**
   * Identify template strengths (top performing metrics)
   */
  identifyStrengths(normalizedScores) {
    const strengths = [];
    const threshold = 0.75;
    
    if (normalizedScores.openRate >= threshold) {
      strengths.push('High open rate - excellent subject line effectiveness');
    }
    if (normalizedScores.responseRate >= threshold) {
      strengths.push('Strong response rate - compelling content and clear CTA');
    }
    if (normalizedScores.collectionSuccess >= threshold) {
      strengths.push('High collection success - effective persuasion and urgency');
    }
    if (normalizedScores.timeToPayment >= threshold) {
      strengths.push('Fast payment processing - creates urgency and momentum');
    }
    
    return strengths;
  }

  /**
   * Identify template weaknesses (underperforming metrics)
   */
  identifyWeaknesses(normalizedScores) {
    const weaknesses = [];
    const threshold = 0.40;
    
    if (normalizedScores.openRate <= threshold) {
      weaknesses.push('Low open rate - subject line needs improvement');
    }
    if (normalizedScores.responseRate <= threshold) {
      weaknesses.push('Poor response rate - content or CTA ineffective');
    }
    if (normalizedScores.collectionSuccess <= threshold) {
      weaknesses.push('Low collection success - lacks persuasive elements');
    }
    if (normalizedScores.timeToPayment <= threshold) {
      weaknesses.push('Slow payment processing - insufficient urgency');
    }
    
    return weaknesses;
  }

  /**
   * Generate improvement recommendations
   */
  generateRecommendations(normalizedScores) {
    const recommendations = [];
    
    // Open rate recommendations
    if (normalizedScores.openRate < 0.50) {
      recommendations.push('Test more compelling subject lines with urgency indicators');
    }
    
    // Response rate recommendations
    if (normalizedScores.responseRate < 0.50) {
      recommendations.push('Strengthen call-to-action and simplify response process');
    }
    
    // Collection success recommendations
    if (normalizedScores.collectionSuccess < 0.50) {
      recommendations.push('Add payment options and emphasize consequences of non-payment');
    }
    
    // Time to payment recommendations
    if (normalizedScores.timeToPayment < 0.50) {
      recommendations.push('Create stronger sense of urgency with time-sensitive language');
    }
    
    // Cross-metric recommendations
    if (normalizedScores.openRate > 0.70 && normalizedScores.responseRate < 0.40) {
      recommendations.push('Good subject line but poor content - revise email body');
    }
    
    return recommendations;
  }

  /**
   * Score multiple templates and rank them
   */
  scoreAndRankTemplates(templateMetrics) {
    const scoredTemplates = templateMetrics.map(metrics => 
      this.calculateScore(metrics)
    );
    
    // Sort by composite score (descending)
    scoredTemplates.sort((a, b) => b.compositeScore - a.compositeScore);
    
    // Add rankings
    scoredTemplates.forEach((template, index) => {
      template.rank = index + 1;
      template.percentile = Math.round(((scoredTemplates.length - index) / scoredTemplates.length) * 100);
    });
    
    return scoredTemplates;
  }

  /**
   * Identify top performing templates for replication
   */
  identifyTopPerformers(scoredTemplates, topCount = 5) {
    const topPerformers = scoredTemplates
      .filter(template => template.compositeScore >= 0.70)
      .slice(0, topCount);
    
    return {
      topPerformers: topPerformers,
      commonStrengths: this.findCommonStrengths(topPerformers),
      replicationGuidelines: this.generateReplicationGuidelines(topPerformers)
    };
  }

  /**
   * Find common strengths among top performers
   */
  findCommonStrengths(topPerformers) {
    const strengthCounts = {};
    
    topPerformers.forEach(template => {
      template.strengths.forEach(strength => {
        strengthCounts[strength] = (strengthCounts[strength] || 0) + 1;
      });
    });
    
    // Return strengths that appear in majority of top performers
    const threshold = Math.ceil(topPerformers.length * 0.6);
    return Object.entries(strengthCounts)
      .filter(([_, count]) => count >= threshold)
      .map(([strength, count]) => ({ strength, frequency: count }));
  }

  /**
   * Generate guidelines for replicating top performers
   */
  generateReplicationGuidelines(topPerformers) {
    const guidelines = [];
    
    // Analyze metric patterns
    const avgScores = this.calculateAverageScores(topPerformers);
    
    if (avgScores.openRate > 0.75) {
      guidelines.push('Focus on compelling subject lines that create urgency');
    }
    
    if (avgScores.responseRate > 0.70) {
      guidelines.push('Use clear, direct call-to-action with minimal friction');
    }
    
    if (avgScores.collectionSuccess > 0.70) {
      guidelines.push('Include multiple payment options and clear consequences');
    }
    
    if (avgScores.timeToPayment > 0.70) {
      guidelines.push('Incorporate time-sensitive language and deadline pressure');
    }
    
    return guidelines;
  }

  /**
   * Calculate average normalized scores for a group of templates
   */
  calculateAverageScores(templates) {
    const sums = templates.reduce((acc, template) => {
      acc.openRate += template.normalizedScores.openRate;
      acc.responseRate += template.normalizedScores.responseRate;
      acc.collectionSuccess += template.normalizedScores.collectionSuccess;
      acc.timeToPayment += template.normalizedScores.timeToPayment;
      return acc;
    }, { openRate: 0, responseRate: 0, collectionSuccess: 0, timeToPayment: 0 });
    
    const count = templates.length;
    return {
      openRate: sums.openRate / count,
      responseRate: sums.responseRate / count,
      collectionSuccess: sums.collectionSuccess / count,
      timeToPayment: sums.timeToPayment / count
    };
  }

  /**
   * Create error score for failed calculations
   */
  createErrorScore(templateId) {
    return {
      templateId: templateId,
      compositeScore: 0,
      grade: 'ERROR',
      error: true,
      message: 'Failed to calculate score due to invalid or missing data'
    };
  }

  /**
   * Generate comprehensive scoring report
   */
  generateScoringReport(templateMetrics) {
    const scoredTemplates = this.scoreAndRankTemplates(templateMetrics);
    const topPerformers = this.identifyTopPerformers(scoredTemplates);
    
    return {
      summary: {
        totalTemplates: scoredTemplates.length,
        averageScore: this.calculateAverageScore(scoredTemplates),
        gradeDistribution: this.calculateGradeDistribution(scoredTemplates),
        topPerformerCount: topPerformers.topPerformers.length
      },
      scoredTemplates: scoredTemplates,
      topPerformers: topPerformers,
      recommendations: this.generateOverallRecommendations(scoredTemplates)
    };
  }

  calculateAverageScore(scoredTemplates) {
    const validScores = scoredTemplates.filter(t => !t.error);
    const sum = validScores.reduce((acc, t) => acc + t.compositeScore, 0);
    return Math.round((sum / validScores.length) * 100) / 100;
  }

  calculateGradeDistribution(scoredTemplates) {
    const distribution = {};
    scoredTemplates.forEach(template => {
      const grade = template.grade;
      distribution[grade] = (distribution[grade] || 0) + 1;
    });
    return distribution;
  }

  generateOverallRecommendations(scoredTemplates) {
    const recommendations = [];
    const averageScores = this.calculateAverageScores(scoredTemplates.filter(t => !t.error));
    
    // Portfolio-level recommendations
    if (averageScores.openRate < 0.50) {
      recommendations.push('Portfolio-wide subject line optimization needed');
    }
    if (averageScores.responseRate < 0.50) {
      recommendations.push('Review and standardize call-to-action formats');
    }
    if (averageScores.collectionSuccess < 0.50) {
      recommendations.push('Implement more aggressive collection strategies');
    }
    
    return recommendations;
  }
}

module.exports = TemplatePerformanceScorer;